// ---------------------------------------------------------------------------
// detectKnowledgeGaps tool
// ---------------------------------------------------------------------------

import type { Worker } from "@notionhq/workers";
import { j } from "@notionhq/workers/schema-builder";

import { KnowledgeGraph } from "../lib/graph.js";
import {
  getDbIds,
  getNotionClient,
  getProjectLogs,
  queryAllRelationships,
} from "../lib/notion-helpers.js";

export function registerDetectKnowledgeGaps(worker: Worker) {
  worker.tool("detectKnowledgeGaps", {
    title: "Detect Knowledge Gaps",
    description:
      "Analyse the knowledge spine for gaps: low-confidence concepts, orphaned nodes, open questions, and stale entries. Returns a prioritised list of gaps with recommendations.",
    schema: j.object({
      domain: j
        .string()
        .describe("Optional domain to narrow the analysis.")
        .nullable(),
      staleDays: j
        .number()
        .describe("Days after which a node is considered stale. Defaults to 14.")
        .nullable(),
    }),
    hints: { readOnlyHint: true },
    execute: async ({ domain, staleDays }, context: any) => {
      const notion = getNotionClient(context.notion);
      const db = getDbIds();

      const nodes = await getProjectLogs(notion, db.projectLog, domain ?? undefined);
      const relationships = db.relationships
        ? await queryAllRelationships(notion, db.relationships)
        : [];

      if (nodes.length === 0) {
        return {
          totalGaps: 0,
          summary: {
            openQuestions: 0,
            lowConfidence: 0,
            orphanNodes: 0,
            leafNodes: 0,
            staleNodes: 0,
          },
          gaps: [] as Array<{ type: string; nodeName: string | null; description: string; recommendation: string }>,
          message: "No knowledge nodes found. Add and process some notes first.",
        };
      }

      const graph = new KnowledgeGraph(nodes, relationships);
      const gaps = graph.detectGaps(staleDays ?? 14);

      const priority: Record<string, number> = {
        open_question: 0,
        low_confidence: 1,
        orphan: 2,
        no_children: 3,
        stale: 4,
      };
      gaps.sort((a, b) => (priority[a.type] ?? 5) - (priority[b.type] ?? 5));

      const summary = {
        openQuestions: gaps.filter((g) => g.type === "open_question").length,
        lowConfidence: gaps.filter((g) => g.type === "low_confidence").length,
        orphanNodes: gaps.filter((g) => g.type === "orphan").length,
        leafNodes: gaps.filter((g) => g.type === "no_children").length,
        staleNodes: gaps.filter((g) => g.type === "stale").length,
      };

      return {
        totalGaps: gaps.length,
        summary,
        gaps: gaps.map((g) => ({
          type: g.type,
          nodeName: g.nodeName ?? null,
          description: g.description,
          recommendation: g.recommendation,
        })),
        message: `Found ${gaps.length} gaps across ${nodes.length} nodes.`,
      };
    },
  });
}
