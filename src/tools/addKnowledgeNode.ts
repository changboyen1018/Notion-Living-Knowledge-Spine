import type { Worker } from "@notionhq/workers";
import { j } from "@notionhq/workers/schema-builder";
import { getDbIds, getNotionClient } from "../lib/notion-helpers.js";

export function registerAddKnowledgeNode(worker: Worker) {
  worker.tool("addKnowledgeNode", {
    title: "Add Knowledge Node",
    description:
      "Create a new knowledge node in the Project Log database. Use this when you've identified a concept, component, system, decision, or question from a meeting note. If a similar node already exists, use updateKnowledgeNode instead.",
    schema: j.object({
      name: j.string().describe("Short, descriptive name for the concept (e.g. 'Raw Data Layer', 'Knowledge Graph')"),
      type: j.enum("system", "component", "concept", "decision", "question").describe("Category of the knowledge node"),
      summary: j.string().describe("1-3 sentence summary explaining this concept and its relevance"),
      meetingNoteId: j.string().describe("The page ID of the meeting note this was extracted from").nullable(),
    }),
    execute: async ({ name, type, summary, meetingNoteId }, context: any) => {
      const notion = getNotionClient(context.notion);
      const db = getDbIds();

      const properties: Record<string, any> = {
        Project: { title: [{ type: "text", text: { content: name } }] },
        Type: { select: { name: type } },
        Summary: { rich_text: [{ type: "text", text: { content: summary } }] },
        "Last Updated": { date: { start: new Date().toISOString() } },
      };

      if (meetingNoteId) {
        properties["Meeting Notes"] = { relation: [{ id: meetingNoteId }] };
      }

      const page = await notion.pages.create({
        parent: { database_id: db.projectLog },
        properties,
      });

      return {
        nodeId: page.id as string,
        name,
        type,
        message: `Created knowledge node "${name}" (${type})`,
      };
    },
  });
}
