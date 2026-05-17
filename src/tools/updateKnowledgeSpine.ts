// ---------------------------------------------------------------------------
// updateKnowledgeSpine tool
//
// Read a meeting note page → extract page body content → AI extraction →
// create/update Project Log entries → create relationships → log changes.
// ---------------------------------------------------------------------------

import type { Worker } from "@notionhq/workers";
import { j } from "@notionhq/workers/schema-builder";

import { extractFromNote } from "../lib/extraction.js";
import {
  getDbIds,
  getNotionClient,
  getMeetingNote,
  updateMeetingNoteStatus,
  getProjectLogs,
  createProjectLogEntry,
  updateProjectSummary,
  createRelationship,
  logChange,
  findBestMatch,
} from "../lib/notion-helpers.js";
import type { ChangeRecord } from "../lib/types.js";

export function registerUpdateKnowledgeSpine(worker: Worker) {
  worker.tool("updateKnowledgeSpine", {
    title: "Update Knowledge Spine",
    description:
      "Process a meeting note: extract its page content, identify concepts and relationships, update the Project Log and Relationships databases. Pass the page ID of a Meeting Notes entry.",
    schema: j.object({
      noteId: j.string().describe("The Notion page ID of the meeting note to process."),
    }),
    execute: async ({ noteId }, context: any) => {
      const notion = getNotionClient(context.notion);
      const db = getDbIds();
      const changes: ChangeRecord[] = [];

      // 1. Read the meeting note + its page body
      const meetingNote = await getMeetingNote(notion, noteId);
      if (meetingNote.processed) {
        return {
          noteId,
          nodesCreated: 0,
          nodesUpdated: 0,
          relationshipsCreated: 0,
          openQuestions: [] as string[],
          changes: [] as ChangeRecord[],
          message: "Note was already processed.",
        };
      }

      if (!meetingNote.transcript || meetingNote.transcript.trim().length === 0) {
        await updateMeetingNoteStatus(notion, noteId, "failed", "No content found in page body.");
        return {
          noteId,
          nodesCreated: 0,
          nodesUpdated: 0,
          relationshipsCreated: 0,
          openQuestions: [] as string[],
          changes: [] as ChangeRecord[],
          message: "No content found in the meeting note page body.",
        };
      }

      // Mark as processing
      await updateMeetingNoteStatus(notion, noteId, "processing");

      try {
        // 2. Load existing Project Log entries for matching
        const existingNodes = await getProjectLogs(notion, db.projectLog);
        const existingNames = existingNodes.map((n) => n.name);

        // 3. Extract concepts & relationships via AI
        const extraction = await extractFromNote(
          meetingNote.transcript,
          existingNames,
        );

        // 4. Resolve concepts → create or update Project Log entries
        const nameToId = new Map<string, string>();
        for (const node of existingNodes) {
          nameToId.set(node.name.toLowerCase(), node.id);
        }

        let nodesCreated = 0;
        let nodesUpdated = 0;

        for (const concept of extraction.concepts) {
          const match = findBestMatch(concept.name, existingNodes);

          if (match) {
            const updatedSummary = match.summary.includes(concept.summary)
              ? match.summary
              : `${match.summary} ${concept.summary}`.trim();

            await updateProjectSummary(notion, match.id, updatedSummary);
            nameToId.set(concept.name.toLowerCase(), match.id);
            nodesUpdated++;

            changes.push({
              nodeId: match.id,
              nodeName: match.name,
              changeType: "updated",
              details: `Updated with evidence from new note.`,
            });

            await logChange(notion, db.changeLog, {
              nodeId: match.id,
              nodeName: match.name,
              changeType: "updated",
              sourceNoteId: noteId,
            });
          } else {
            const newId = await createProjectLogEntry(
              notion,
              db.projectLog,
              {
                name: concept.name,
                type: concept.type,
                summary: concept.summary,
                sourceNoteId: noteId,
                confidence: 0.6,
                domain: extraction.domain,
              },
            );

            nameToId.set(concept.name.toLowerCase(), newId);
            nodesCreated++;

            changes.push({
              nodeId: newId,
              nodeName: concept.name,
              changeType: "created",
              details: `New ${concept.type}: ${concept.summary}`,
            });

            await logChange(notion, db.changeLog, {
              nodeId: newId,
              nodeName: concept.name,
              changeType: "created",
              sourceNoteId: noteId,
            });
          }
        }

        // 5. Create relationships
        let relationshipsCreated = 0;

        if (db.relationships) {
          for (const rel of extraction.relationships) {
            const sourceId = nameToId.get(rel.sourceName.toLowerCase());
            const targetId = nameToId.get(rel.targetName.toLowerCase());

            if (sourceId && targetId) {
              await createRelationship(notion, db.relationships, {
                sourceId,
                targetId,
                relationshipType: rel.relationshipType,
                evidence: rel.evidence,
                confidence: 0.7,
                sourceName: rel.sourceName,
                targetName: rel.targetName,
              });
              relationshipsCreated++;

              changes.push({
                nodeId: sourceId,
                nodeName: rel.sourceName,
                changeType: "linked",
                details: `Linked to "${rel.targetName}" via ${rel.relationshipType}.`,
              });
            }
          }
        }

        // 6. Create question nodes for open questions
        for (const question of extraction.openQuestions) {
          const questionName = question.length > 80
            ? question.slice(0, 77) + "..."
            : question;

          const newId = await createProjectLogEntry(
            notion,
            db.projectLog,
            {
              name: questionName,
              type: "question",
              summary: question,
              sourceNoteId: noteId,
              confidence: 0.3,
              domain: extraction.domain,
            },
          );
          nodesCreated++;

          changes.push({
            nodeId: newId,
            nodeName: questionName,
            changeType: "created",
            details: `Open question captured.`,
          });
        }

        // 7. Mark as processed
        await updateMeetingNoteStatus(notion, noteId, "processed");

        return {
          noteId,
          nodesCreated,
          nodesUpdated,
          relationshipsCreated,
          openQuestions: extraction.openQuestions,
          changes: changes.map((c) => ({ ...c })),
          message: `Processed: ${nodesCreated} created, ${nodesUpdated} updated, ${relationshipsCreated} relationships.`,
        };
      } catch (err: any) {
        await updateMeetingNoteStatus(
          notion,
          noteId,
          "failed",
          err?.message ?? "Unknown error",
        );
        throw err;
      }
    },
  });
}
