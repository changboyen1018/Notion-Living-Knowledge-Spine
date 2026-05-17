// ---------------------------------------------------------------------------
// generateKnowledgeMap tool
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

export function registerGenerateKnowledgeMap(worker: Worker) {
  worker.tool("generateKnowledgeMap", {
    title: "Generate Knowledge Map",
    description:
      "Generate a Mermaid diagram of the knowledge spine. Returns a renderable Mermaid graph string showing all concepts and their relationships. Optionally filter by domain.",
    schema: j.object({
      domain: j
        .string()
        .describe("Optional domain to filter the map.")
        .nullable(),
    }),
    hints: { readOnlyHint: true },
    execute: async ({ domain }, context: any) => {
      const notion = getNotionClient(context.notion);
      const db = getDbIds();

      const nodes = await getProjectLogs(notion, db.projectLog, domain ?? undefined);
      const relationships = db.relationships
        ? await queryAllRelationships(notion, db.relationships)
        : [];

      if (nodes.length === 0) {
        return {
          nodeCount: 0,
          relationshipCount: 0,
          rootConcepts: [] as string[],
          domains: [] as string[],
          mermaid: "",
          message: "No knowledge nodes found. Add and process some notes first.",
        };
      }

      const graph = new KnowledgeGraph(nodes, relationships);
      const mermaid = graph.toMermaid();
      const roots = graph.getRoots();

      return {
        nodeCount: nodes.length,
        relationshipCount: relationships.length,
        rootConcepts: roots.map((r) => r.name),
        domains: [...new Set(nodes.map((n) => n.domain))],
        mermaid,
        message: `Knowledge map: ${nodes.length} nodes, ${relationships.length} relationships.`,
      };
    },
  });
}
