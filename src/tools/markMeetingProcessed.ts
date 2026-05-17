import type { Worker } from "@notionhq/workers";
import { j } from "@notionhq/workers/schema-builder";
import { getNotionClient } from "../lib/notion-helpers.js";

export function registerMarkMeetingProcessed(worker: Worker) {
  worker.tool("markMeetingProcessed", {
    title: "Mark Meeting Processed",
    description:
      "Mark a meeting note as processed after you have finished extracting all knowledge nodes and relationships from it. This prevents re-processing the same meeting.",
    schema: j.object({
      meetingNoteId: j.string().describe("The page ID of the meeting note entry to mark as processed"),
    }),
    execute: async ({ meetingNoteId }, context: any) => {
      const notion = getNotionClient(context.notion);

      await notion.pages.update({
        page_id: meetingNoteId,
        properties: {
          Status: { select: { name: "processed" } },
          "Last Processed at": { date: { start: new Date().toISOString() } },
        },
      });

      return {
        meetingNoteId,
        message: "Meeting note marked as processed.",
      };
    },
  });
}
