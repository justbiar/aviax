export const fmtPx = (v: number | string | undefined) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return "-";
  const d = n >= 1000 ? 1 : n >= 100 ? 2 : n >= 1 ? 3 : n >= 0.01 ? 5 : 7;
  return n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
};
export const fmtNum = (v: number | string | undefined, d = 2) => {
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }) : "-";
};
export const fmtPct = (v: number, d = 2) => `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`;
export const fmtCompact = (v: number) => Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(v);
export const short = (instId: string) => instId.replace("-USDT-SWAP", "").replace("-USDT", "");
