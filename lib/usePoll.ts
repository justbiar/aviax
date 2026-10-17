"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export function usePoll<T>(url: string | null, ms: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const urlRef = useRef(url);
  urlRef.current = url;

  const load = useCallback(async () => {
    const u = urlRef.current;
    if (!u) return;
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
    }
  }, []);

  useEffect(() => {
    setData(null);
    load();
    const id = setInterval(load, ms);
    return () => clearInterval(id);
  }, [url, ms, load]);

  return { data, error, reload: load };
}
