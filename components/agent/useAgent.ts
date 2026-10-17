"use client";

import { useCallback, useRef, useState } from "react";
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

export function useAgent() {
  const [s, setS] = useState<AgentState>(initial);
  const idRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const apply = useCallback((ev: AgentEvent) => {
    setS((p) => {
      const n = { ...p };
      const log = (text: string, tone?: string, tool?: string) => {
        n.logs = [...p.logs, { id: ++idRef.current, t: Date.now() - p.startedAt, text, tone, tool }].slice(-200);
      };
      switch (ev.type) {
        case "hello":
          n.live = ev.live;
          n.providers = ev.providers;
          n.jevModel = ev.jevModel;
          n.execute = ev.execute;
          log(`agent online · ${ev.execute ? "EXECUTE (OKX demo)" : "PLAN modu"} · JEV ${ev.providers.jev === "openrouter" ? `openrouter:${ev.jevModel}` : ev.providers.jev} · LAYA ${ev.providers.laya}`, "info");
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
    });
  }, []);

  const run = useCallback(
    async (opts: { execute: boolean; universe: number; pace: number }) => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setS({ ...initial(), running: true, startedAt: Date.now() });
      try {
        const res = await fetch("/api/agent", { method: "POST", body: JSON.stringify(opts), signal: ac.signal, headers: { "Content-Type": "application/json" } });
        const reader = res.body!.getReader();
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
      }
    },
    [apply],
  );

  return { s, run };
}
