import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "rgb(var(--ink) / <alpha-value>)",
        paper: "rgb(var(--paper) / <alpha-value>)",
        muted: "rgb(var(--muted) / <alpha-value>)",
        line: "rgb(var(--line) / <alpha-value>)",
        sun: "rgb(var(--sun) / <alpha-value>)",
        long: "rgb(var(--long) / <alpha-value>)",
        short: "rgb(var(--short) / <alpha-value>)",
        stage: "rgb(var(--stage) / <alpha-value>)",
        jev: "rgb(var(--jev) / <alpha-value>)",
        laya: "rgb(var(--laya) / <alpha-value>)",
      },
      fontFamily: {
        display: ["var(--font-display)", "Impact", "sans-serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      borderRadius: { btn: "10px", card: "18px" },
      boxShadow: {
        btn: "0 1px 2px 0 rgb(20 20 16 / 0.06)",
        card: "0 2px 6px 0 rgb(20 20 16 / 0.05), 0 18px 40px -12px rgb(20 20 16 / 0.2)",
        brut: "4px 4px 0 0 rgb(20 20 16)",
      },
      transitionTimingFunction: { out: "cubic-bezier(0.22, 1, 0.36, 1)" },
    },
  },
  plugins: [],
} satisfies Config;
