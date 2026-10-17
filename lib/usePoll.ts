"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Polls a JSON endpoint. A slow response never overlaps the next tick, and hidden tabs do not
 * poll (they refresh once when they become visible again).
 */
export function usePoll<T>(url: string | null, ms: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const urlRef = useRef(url);
  urlRef.current = url;
  const inflight = useRef(false);

  const load = useCallback(async () => {
    const u = urlRef.current;
    if (!u || inflight.current) return;
    inflight.current = true;
    try {
      const r = await fetch(u, { cache: "no-store" });
      const j = await r.json();
      if (u !== urlRef.current) return;
      if (j?.error) setError(j.error);
      else {
        setData(j);
        setError(null);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      inflight.current = false;
    }
  }, []);

  useEffect(() => {
    setData(null);
    load();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, ms);
    const onVisible = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [url, ms, load]);

  return { data, error, reload: load };
}
