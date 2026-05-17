// ---------------------------------------------------------------------------
// findRecallPath tool
// ---------------------------------------------------------------------------

import type { Worker } from "@notionhq/workers";
import { j } from "@notionhq/workers/schema-builder";

import { KnowledgeGraph } from "../lib/graph.js";
import {
  getDbIds,
  getNotionClient,
  getProjectLogs,
  queryAllRelationships,
  saveRecallPath,
} from "../lib/notion-helpers.js";

export function registerFindRecallPath(worker: Worker) {
  worker.tool("findRecallPath", {
    title: "Find Recall Path",
    description:
      "Given a question or topic, find a structured recall path through the knowledge spine — from the high-level concept down to the specific detail. Use this when the user wants to recall or re-learn something.",
    schema: j.object({
      query: j.string().describe("The question or topic to recall."),
      domain: j
        .string()
        .describe("Optional domain to narrow the search.")
        .nullable(),
    }),
    hints: { readOnlyHint: false },
    execute: async ({ query, domain }, context: any) => {
      const notion = getNotionClient(context.notion);
      const db = getDbIds();

      const nodes = await getProjectLogs(notion, db.projectLog, domain ?? undefined);
      const relationships = db.relationships
        ? await queryAllRelationships(notion, db.relationships)
        : [];
      const graph = new KnowledgeGraph(nodes, relationships);

      const matches = graph.searchNodes(query);
      if (matches.length === 0) {
        return {
          found: false as const,
          query,
          message: `No knowledge nodes found matching "${query}". Try a different search term or add more notes.`,
          suggestions: graph.getRoots().map((r) => r.name).slice(0, 5),
          matchedNode: null,
          recallPath: [] as Array<{ name: string; type: string; summary: string; depth: number }>,
          subtree: [] as Array<{ name: string; type: string; summary: string; depth: number }>,
          sourceEvidence: [] as string[],
          explanation: "",
        };
      }

      const sorted = matches.sort((a, b) => {
        const aExact = a.name.toLowerCase() === query.toLowerCase() ? 0 : 1;
        const bExact = b.name.toLowerCase() === query.toLowerCase() ? 0 : 1;
        if (aExact !== bExact) return aExact - bExact;
        return a.name.length - b.name.length;
      });
      const bestMatch = sorted[0];

      const pathSteps = graph.findPathToNode(bestMatch.id);
      const subtree = graph.buildSubtree(bestMatch.id, 3);

      const evidence: string[] = [];
      for (const step of pathSteps) {
        const edges = graph.getEdgesFrom(step.nodeId);
        for (const edge of edges) {
          if (edge.evidence) evidence.push(edge.evidence);
        }
      }

      const pathDescription = pathSteps
        .map((s) => `${"  ".repeat(s.depth)}→ ${s.nodeName}: ${s.summary}`)
        .join("\n");

      const subtreeDescription = subtree
        .map(
          (s) =>
            `${"  ".repeat(s.depth)}${s.depth === 0 ? "●" : "├──"} ${s.nodeName}: ${s.summary}`,
        )
        .join("\n");

      const explanation = [
        `Recall path for "${query}":`,
        "",
        "PATH FROM ROOT:",
        pathDescription,
        "",
        "KNOWLEDGE SUBTREE:",
        subtreeDescription,
      ].join("\n");

      await saveRecallPath(notion, db.recallPaths, {
        question: query,
        pathNodesJson: JSON.stringify(
          pathSteps.map((s) => ({
            id: s.nodeId,
            name: s.nodeName,
            type: s.nodeType,
            depth: s.depth,
          })),
        ),
        explanation,
        sourceEvidence: evidence.join("\n---\n"),
      });

      return {
        found: true as const,
        query,
        message: `Found recall path for "${query}" via "${bestMatch.name}".`,
        suggestions: [] as string[],
        matchedNode: {
          name: bestMatch.name,
          type: bestMatch.type,
          summary: bestMatch.summary,
          confidence: bestMatch.confidence,
        },
        recallPath: pathSteps.map((s) => ({
          name: s.nodeName,
          type: s.nodeType,
          summary: s.summary,
          depth: s.depth,
        })),
        subtree: subtree.map((s) => ({
          name: s.nodeName,
          type: s.nodeType,
          summary: s.summary,
          depth: s.depth,
        })),
        sourceEvidence: evidence.slice(0, 10),
        explanation,
      };
    },
  });
}
