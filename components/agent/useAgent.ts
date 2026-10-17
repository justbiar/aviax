"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentEvent, Plan, Stage } from "@/lib/agent";
import type { Features } from "@/lib/features";
import type { DecisionResult } from "@/lib/decide";

export type DecisionEv = Extract<AgentEvent, { type: "decision" }>;
export type LogLine = { id: number; t: number; text: string; tool?: string; tone?: string };
export type StageStatus = "idle" | "start" | "done" | "skip" | "fail";

export const STAGES: { key: Stage; label: string; who: string }[] = [
  { key: "scan", label: "Tarama", who: "ATK" },
  { key: "features", label: "Özellikler", who: "ATK" },
  { key: "workers", label: "Paralel tahmin", who: "JEV + LAYA" },
  { key: "pair", label: "Parite", who: "JEV choice" },
  { key: "direction", label: "Yön", who: "JEV choice" },
  { key: "size", label: "Boyut", who: "JEV score" },
  { key: "risk", label: "TP / SL", who: "JEV choice" },
  { key: "gate", label: "Risk kapısı", who: "JEV noul" },
  { key: "execute", label: "Emir", who: "ATK" },
];

export type AgentState = {
  running: boolean;
  startedAt: number;
  live: { jev: boolean; laya: boolean; okx: boolean; llm: boolean } | null;
  providers: { jev: string; laya: string } | null;
  jevModel: string;
  execute: boolean;
  stages: Record<string, StageStatus>;
  stageNotes: Record<string, string>;
  current: Stage | null;
  logs: LogLine[];
  pairs: Features[];
  workers: Record<string, { jev: DecisionResult; laya: DecisionResult; edge: number }>;
  decisions: Partial<Record<DecisionEv["key"], DecisionEv>>;
  plan: Plan | null;
  order: { ok: boolean; detail: string; ordId?: string } | null;
  narrations: string[];
  verdict: string | null;
  totalMs: number;
  modelCalls: number;
  modelMs: number;
};

const initial = (): AgentState => ({
  running: false,
  startedAt: 0,
  live: null,
  providers: null,
  jevModel: "",
  execute: false,
  stages: {},
  stageNotes: {},
  current: null,
  logs: [],
  pairs: [],
  workers: {},
  decisions: {},
  plan: null,
  order: null,
  narrations: [],
  verdict: null,
  totalMs: 0,
  modelCalls: 0,
  modelMs: 0,
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Fleet events carry a server timestamp so replays keep real timings in the log. */
type TimedEvent = AgentEvent & { ts?: number };
let logSeq = 0;

/** Pure reducer: folds one agent event into the stage state. */
export function reduce(p: AgentState, ev: TimedEvent): AgentState {
  const n = { ...p };
  const now = ev.ts ?? Date.now();
  const log = (text: string, tone?: string, tool?: string) => {
    n.logs = [...p.logs, { id: ++logSeq, t: Math.max(0, now - (n.startedAt || now)), text, tone, tool }].slice(-200);
  };
  switch (ev.type) {
    case "hello":
      n.startedAt = ev.at;
      n.running = true;
      n.live = ev.live;
      n.providers = ev.providers;
      n.jevModel = ev.jevModel;
      n.execute = ev.execute;
      log(`agent online · ${ev.execute ? "EXECUTE" : "PLAN modu"} · JEV ${ev.providers.jev === "shadow" ? "shadow" : ev.jevModel} · LAYA ${ev.providers.laya === "endpoint" ? "laya (yerel)" : ev.providers.laya}`, "info");
      break;
    case "stage":
      n.stages = { ...p.stages, [ev.stage]: ev.status };
      if (ev.note) n.stageNotes = { ...p.stageNotes, [ev.stage]: ev.note };
      if (ev.status === "start") n.current = ev.stage;
      break;
    case "log":
      log(ev.text, ev.tone, ev.tool);
      break;
    case "universe":
      n.pairs = ev.pairs;
      break;
    case "worker":
      n.workers = { ...p.workers, [ev.instId]: { jev: ev.jev, laya: ev.laya, edge: ev.edge } };
      n.modelCalls = p.modelCalls + 2;
      n.modelMs = p.modelMs + ev.jev.latencyMs + ev.laya.latencyMs;
      break;
    case "decision":
      n.decisions = { ...p.decisions, [ev.key]: ev };
      if (ev.key !== "leverage" && ev.key !== "sl") {
        n.modelCalls = p.modelCalls + 2;
        n.modelMs = p.modelMs + ev.jevMs + ev.layaMs;
      }
      break;
    case "plan":
      n.plan = ev.plan;
      break;
    case "order":
      n.order = ev;
      break;
    case "narration":
      n.narrations = [...p.narrations, ev.text];
      break;
    case "done":
      n.running = false;
      n.verdict = ev.verdict;
      n.totalMs = ev.ms;
      n.current = null;
      log(`run tamamlandı · ${ev.verdict.toUpperCase()} · ${(ev.ms / 1000).toFixed(2)}s`, ev.verdict === "error" ? "err" : "ok");
      break;
  }
  return n;
}

type Snapshot = { state: AgentState; runId: number; seq: number };

export function useAgent() {
  const [s, setS] = useState<AgentState>(initial);
  const abortRef = useRef<AbortController | null>(null);
  /** Per-agent stage snapshots, so switching between agents is instant and never mixes runs. */
  const cache = useRef(new Map<string, Snapshot>());
  const [followId, setFollowId] = useState<string | null>(null);

  const apply = useCallback((ev: AgentEvent) => setS((p) => reduce(p, ev)), []);

  /** Plays any NDJSON agent stream on the stage (trial runs, paid marketplace scenarios). */
  const runStream = useCallback(
    async (start: (signal: AbortSignal) => Promise<Response>, pace = 1) => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setFollowId(null);
      setS({ ...initial(), running: true, startedAt: Date.now() });
      const opts = { pace };
      try {
        const res = await start(ac.signal);
        if (!res.ok || !res.body) {
          const j = await res.json().catch(() => ({}));
          throw new Error((j as { error?: string }).error || `HTTP ${res.status}`);
        }
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, i);
            buf = buf.slice(i + 1);
            if (!line.trim()) continue;
            const ev = JSON.parse(line) as AgentEvent;
            apply(ev);
            // Presentation pacing: decisions arrive in milliseconds, we let the eye follow them.
            if (opts.pace > 0) {
              const w = ev.type === "decision" ? 900 : ev.type === "stage" && ev.status === "done" ? 350 : ev.type === "worker" ? 260 : ev.type === "universe" ? 500 : 60;
              await sleep(w * opts.pace);
            }
          }
        }
      } catch (e) {
        if ((e as Error).name !== "AbortError") apply({ type: "log", tone: "err", text: (e as Error).message });
        setS((p) => ({ ...p, running: false }));
        throw e;
      }
    },
    [apply],
  );

  const run = useCallback(
    (opts: { execute: boolean; universe: number; pace: number }) =>
      runStream((signal) => fetch("/api/agent", { method: "POST", body: JSON.stringify(opts), signal, headers: { "Content-Type": "application/json" } }), opts.pace).catch(() => null),
    [runStream],
  );

  /**
   * Follow a fleet agent. On attach the agent's latest run is rebuilt instantly from
   * its event log (or restored from cache); only events that arrive afterwards animate.
   */
  useEffect(() => {
    if (!followId) return;
    abortRef.current?.abort();
    const id = followId;
    let alive = true;
    let snap: Snapshot = cache.current.get(id) ?? { state: initial(), runId: -1, seq: 0 };
    setS(snap.state);
    const queue: AgentEvent[] = [];
    let draining = false;

    const commit = (state: AgentState) => {
      snap = { ...snap, state };
      cache.current.set(id, snap);
      if (alive) setS(state);
    };
    const drain = async () => {
      if (draining) return;
      draining = true;
      while (alive && queue.length) {
        const ev = queue.shift()!;
        commit(reduce(snap.state, ev));
        const w = queue.length > 25 ? 0 : ev.type === "decision" ? 700 : ev.type === "worker" ? 180 : ev.type === "universe" ? 350 : 40;
        if (w) await sleep(w);
      }
      draining = false;
    };

    const poll = async () => {
      let first = true;
      while (alive) {
        try {
          const r = await fetch(`/api/fleet/${id}/events?since=${snap.runId === -1 ? 0 : snap.seq}`, { cache: "no-store" });
          const j = (await r.json()) as { runId?: number; events?: AgentEvent[]; total?: number };
          if (!alive) return;
          if (j.runId !== undefined) {
            if (j.runId !== snap.runId) {
              // Different run than the snapshot: rebuild from that run's full log.
              const full = snap.runId === -1 ? j : await fetch(`/api/fleet/${id}/events?since=0`, { cache: "no-store" }).then((x) => x.json());
              if (!alive) return;
              queue.length = 0;
              const events: AgentEvent[] = full.events ?? [];
              // A run that is already underway or finished is shown at once; a brand-new run animates.
              const instant = first || events.length > 6;
              snap = { state: instant ? events.reduce(reduce, initial()) : initial(), runId: full.runId, seq: events.length };
              commit(snap.state);
              if (!instant) {
                queue.push(...events);
                drain();
              }
            } else if (j.events?.length) {
              snap = { ...snap, seq: snap.seq + j.events.length };
              cache.current.set(id, snap);
              if (first) commit(j.events.reduce(reduce, snap.state));
              else {
                queue.push(...j.events);
                drain();
              }
            }
          }
        } catch {
          /* keep polling */
        }
        first = false;
        await sleep(1000);
      }
    };
    poll();
    return () => {
      alive = false;
      // Fold events still waiting for animation into the cache so nothing is lost on return.
      const rest = queue.splice(0);
      if (rest.length) cache.current.set(id, { ...snap, state: rest.reduce(reduce, snap.state) });
    };
  }, [followId]);

  return { s, run, runStream, followId, follow: setFollowId };
}
