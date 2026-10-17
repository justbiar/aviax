#!/usr/bin/env node

import { loadEnvConfig } from "@next/env";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ask, DEFAULT_SEATS, recordHash } from "../lib/decisionLayer";
import type { Question } from "../lib/decide";

// MCP clients launch this process with the project as cwd. Load the same local
// model endpoints used by the Aviax web app without ever writing logs to stdout.
loadEnvConfig(process.cwd());

const server = new McpServer({ name: "aviax-decision", version: "1.0.0" });

server.registerTool(
  "aviax_decide",
  {
    title: "Aviax Decision Model",
    description:
      "Ask Aviax's locally running decision models to choose among explicit options. Returns each model's probability distribution, weighted ensemble, selected option, confidence, agreement, latency, and a hash. This tool does not place or authorize trades.",
    inputSchema: {
      state: z.string().trim().min(1).max(12000).describe("The facts and context the decision models should evaluate."),
      questions: z
        .record(z.string(), z.unknown())
        .refine((value) => Object.keys(value).length > 0 && Object.keys(value).length <= 16, "Provide 1 to 16 questions."),
    },
  },
  async ({ state, questions: rawQuestions }) => {
    try {
      const questions = validateQuestions(rawQuestions);
      // Strict mode prevents a shadow/fallback result from being presented as a
      // live local-model decision.
      const result = await ask(state, questions, DEFAULT_SEATS, { strict: true });
      const decisionHash = recordHash({ state, questions, result });
      const response = { ...result, decisionHash };
      return { content: [{ type: "text", text: JSON.stringify(response) }] };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text", text: error instanceof Error ? error.message : "Aviax decision failed" }],
      };
    }
  },
);

function validateQuestions(input: Record<string, unknown>): Record<string, Question> {
  const result: Record<string, Question> = {};
  for (const [key, raw] of Object.entries(input)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(key) || !raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error(`Invalid question: ${key}`);
    }
    const q = raw as Record<string, unknown>;
    if (typeof q.instructions !== "string" || !q.instructions.trim() || q.instructions.length > 1000) {
      throw new Error(`Question ${key} needs instructions (max 1000 characters).`);
    }
    if (q.type === "choice") {
      if (!q.criteria || typeof q.criteria !== "object" || Array.isArray(q.criteria)) throw new Error(`Question ${key} needs choice criteria.`);
      const criteria = q.criteria as Record<string, unknown>;
      const entries = Object.entries(criteria);
      if (entries.length < 2 || entries.length > 12 || entries.some(([label, description]) => !label || label.length > 80 || typeof description !== "string" || !description.trim() || description.length > 500)) {
        throw new Error(`Question ${key} needs 2 to 12 labeled options with descriptions.`);
      }
      result[key] = { type: "choice", instructions: q.instructions, criteria: criteria as Record<string, string> };
    } else if (q.type === "score") {
      if (!Array.isArray(q.criteria) || q.criteria.length < 2 || q.criteria.length > 12 || q.criteria.some((v) => typeof v !== "string" || !v.trim() || v.length > 200)) {
        throw new Error(`Question ${key} needs 2 to 12 score labels.`);
      }
      result[key] = { type: "score", instructions: q.instructions, criteria: q.criteria as string[] };
    } else if (q.type === "noul") {
      result[key] = { type: "noul", instructions: q.instructions };
    } else {
      throw new Error(`Question ${key} type must be choice, score, or noul.`);
    }
  }
  return result;
}

async function main() {
  const transport = new StdioServerTransport();
  server.server.onerror = (error) => process.stderr.write(`[aviax-decision-mcp] ${error.message}\n`);
  await server.connect(transport);
}

void main().catch((error: unknown) => {
  process.stderr.write(`[aviax-decision-mcp] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
