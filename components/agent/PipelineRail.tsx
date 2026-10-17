"use client";

import { motion } from "framer-motion";
import { STAGES, type AgentState } from "./useAgent";

export function PipelineRail({ s }: { s: AgentState }) {
  const doneCount = STAGES.filter((st) => ["done", "skip", "fail"].includes(s.stages[st.key] ?? "")).length;
  return (
    <div className="relative">
      <div className="absolute left-0 right-0 top-[15px] h-px bg-white/10" aria-hidden />
      <motion.div className="absolute left-0 top-[15px] h-px bg-sun" animate={{ width: `${(doneCount / (STAGES.length - 1)) * 100}%` }} transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }} style={{ maxWidth: "100%" }} aria-hidden />
      <ol className="relative grid grid-cols-9 gap-1">
        {STAGES.map((st, i) => {
          const status = s.stages[st.key] ?? "idle";
          const active = status === "start";
          const dot =
            status === "done" ? "bg-sun border-sun text-black" : status === "fail" ? "bg-short border-short text-white" : status === "skip" ? "bg-white/10 border-white/20 text-white/40" : active ? "bg-black border-sun text-sun" : "bg-black border-white/20 text-white/40";
          return (
            <li key={st.key} className="flex min-w-0 flex-col items-center text-center">
              <span className={`relative grid h-[30px] w-[30px] place-items-center rounded-full border-2 font-mono text-[11px] font-bold transition-colors duration-300 ${dot}`}>
                {status === "done" ? "✓" : status === "fail" ? "✕" : i + 1}
                {active && <span className="absolute inset-0 animate-ping rounded-full border border-sun" />}
              </span>
              <span className={`mt-2 truncate text-[11px] font-bold sm:text-xs ${active ? "text-sun" : status === "idle" ? "text-white/40" : "text-white"}`}>{st.label}</span>
              <span className="hidden truncate font-mono text-[9px] text-white/35 md:block">{s.stageNotes[st.key] ?? st.who}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
