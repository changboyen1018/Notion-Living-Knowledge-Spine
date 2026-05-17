import type { Worker } from "@notionhq/workers";
import { j } from "@notionhq/workers/schema-builder";
import { getNotionClient } from "../lib/notion-helpers.js";

export function registerUpdateKnowledgeNode(worker: Worker) {
  worker.tool("updateKnowledgeNode", {
    title: "Update Knowledge Node",
    description:
      "Update an existing knowledge node's summary with new information from a meeting. Use this when a concept already exists in the Project Log and you want to enrich it with newly learned details.",
    schema: j.object({
      nodeId: j.string().describe("The page ID of the existing knowledge node to update"),
      newSummary: j.string().describe("Updated summary incorporating both old and new information"),
    }),
    execute: async ({ nodeId, newSummary }, context: any) => {
      const notion = getNotionClient(context.notion);

      await notion.pages.update({
        page_id: nodeId,
        properties: {
          Summary: { rich_text: [{ type: "text", text: { content: newSummary } }] },
          "Last Updated": { date: { start: new Date().toISOString() } },
        },
      });

      return {
        nodeId,
        message: `Updated knowledge node summary`,
      };
    },
  });
}
