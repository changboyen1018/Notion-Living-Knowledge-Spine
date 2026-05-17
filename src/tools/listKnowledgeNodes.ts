import type { Worker } from "@notionhq/workers";
import { j } from "@notionhq/workers/schema-builder";
import { getDbIds, getNotionClient } from "../lib/notion-helpers.js";

export function registerListKnowledgeNodes(worker: Worker) {
  worker.tool("listKnowledgeNodes", {
    title: "List Knowledge Nodes",
    description:
      "List all existing knowledge nodes in the Project Log. Use this BEFORE adding new nodes to check if a concept already exists — if it does, use updateKnowledgeNode instead of creating a duplicate.",
    schema: j.object({}),
    hints: { readOnlyHint: true },
    execute: async (_input, context: any) => {
      const notion = getNotionClient(context.notion);
      const db = getDbIds();

      const results: any[] = [];
      let cursor: string | undefined;

      do {
        const resp: any = await notion.databases.query({
          database_id: db.projectLog,
          start_cursor: cursor,
          page_size: 100,
        });
        results.push(...resp.results);
        cursor = resp.has_more ? resp.next_cursor : undefined;
      } while (cursor);

      const nodes = results.map((page: any) => {
        const p = page.properties;
        const titleArr = p["Project"]?.title ?? [];
        const summaryArr = p["Summary"]?.rich_text ?? [];
        return {
          nodeId: page.id as string,
          name: titleArr.map((t: any) => t.plain_text ?? "").join(""),
          type: p["Type"]?.select?.name ?? "concept",
          summary: summaryArr.map((t: any) => t.plain_text ?? "").join(""),
          lastUpdated: p["Last Updated"]?.date?.start ?? null,
        };
      });

      return {
        totalNodes: nodes.length,
        nodes,
      };
    },
  });
}
