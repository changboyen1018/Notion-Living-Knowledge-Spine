import type { Worker } from "@notionhq/workers";
import { j } from "@notionhq/workers/schema-builder";
import { getDbIds, getNotionClient } from "../lib/notion-helpers.js";

export function registerAddRelationship(worker: Worker) {
  worker.tool("addRelationship", {
    title: "Add Relationship",
    description:
      "Create a directional relationship between two knowledge nodes. Use this after identifying how concepts relate to each other (e.g. 'Raw Data Layer feeds_into Transformation Layer').",
    schema: j.object({
      sourceNodeId: j.string().describe("Page ID of the source knowledge node"),
      targetNodeId: j.string().describe("Page ID of the target knowledge node"),
      relationshipType: j.enum("depends_on", "feeds_into", "owned_by", "blocked_by", "related_to", "part_of")
        .describe("Type of relationship from source to target"),
      evidence: j.string().describe("Brief evidence or quote from the meeting that supports this relationship"),
      label: j.string().describe("Human-readable label like 'Raw Data Layer → Transformation Layer'"),
    }),
    execute: async ({ sourceNodeId, targetNodeId, relationshipType, evidence, label }, context: any) => {
      const notion = getNotionClient(context.notion);
      const db = getDbIds();

      if (!db.relationships) {
        return {
          relationshipId: "",
          label,
          relationshipType,
          message: "Relationships database not configured. Skipped.",
        };
      }

      const page = await notion.pages.create({
        parent: { database_id: db.relationships },
        properties: {
          Name: { title: [{ type: "text", text: { content: label } }] },
          "Source Node": { relation: [{ id: sourceNodeId }] },
          "Target Node": { relation: [{ id: targetNodeId }] },
          "Relationship Type": { select: { name: relationshipType } },
          Evidence: { rich_text: [{ type: "text", text: { content: evidence } }] },
          Confidence: { number: 0.8 },
        },
      });

      return {
        relationshipId: page.id as string,
        label,
        relationshipType,
        message: `Created relationship: ${label} (${relationshipType})`,
      };
    },
  });
}
