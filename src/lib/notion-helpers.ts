// ---------------------------------------------------------------------------
// Notion API helpers — matched to actual workspace schemas (May 16 2026).
//
// Meeting Notes DB: Title, Status, Note page (URL), Project (relation),
//                   Created at, Last Processed at, Failure reason
// Project Log DB:   Project (title), Summary, Type, Last Updated,
//                   Meeting Notes (relation)
// Relationships DB: Name, Source Node, Relationship Type, Target Node,
//                   Evidence, Confidence
// ---------------------------------------------------------------------------

import { Client } from "@notionhq/client";

import type {
  KnowledgeNode,
  Relationship,
  NodeType,
  RelationshipType,
} from "./types.js";

export function getDbIds() {
  return {
    meetingNotes: process.env.MEETING_NOTES_DB_ID!,
    projectLog: process.env.PROJECT_LOG_DB_ID!,
    relationships: process.env.RELATIONSHIPS_DB_ID,
    changeLog: process.env.CHANGE_LOG_DB_ID,
    recallPaths: process.env.RECALL_PATHS_DB_ID,
  };
}

/** Get a Notion client — uses context.notion if available, otherwise creates from env token. */
export function getNotionClient(contextNotion?: any): NotionClient {
  if (contextNotion?.pages?.retrieve && contextNotion?.databases?.query) {
    return contextNotion;
  }
  const token = process.env.NOTION_API_TOKEN;
  if (!token) {
    throw new Error("NOTION_API_TOKEN is not set and context.notion is not available.");
  }
  return new Client({ auth: token }) as any;
}

// ---------------------------------------------------------------------------
// Generic helpers
// ---------------------------------------------------------------------------

type NotionClient = {
  pages: {
    retrieve: (args: { page_id: string }) => Promise<any>;
    create: (args: any) => Promise<any>;
    update: (args: any) => Promise<any>;
  };
  databases: {
    query: (args: any) => Promise<any>;
  };
  blocks: {
    children: {
      list: (args: { block_id: string; page_size?: number }) => Promise<any>;
    };
  };
};

function richTextPlain(text: string) {
  return [{ type: "text", text: { content: text } }];
}

function extractPlainText(richTextArray: any[]): string {
  if (!richTextArray?.length) return "";
  return richTextArray.map((rt: any) => rt.plain_text ?? "").join("");
}

// ---------------------------------------------------------------------------
// A. Meeting Notes — the input registry
//
// Schema: Title (title), Status (select), Note page (url),
//         Project (relation -> Project Log), Created at, Last Processed at
// ---------------------------------------------------------------------------

export async function getMeetingNotes(
  notion: NotionClient,
  dbId: string,
  onlyUnprocessed = false,
) {
  const filter = onlyUnprocessed
    ? { property: "Status", select: { equals: "unprocessed" } }
    : undefined;

  const results: any[] = [];
  let cursor: string | undefined;
  do {
    const resp: any = await notion.databases.query({
      database_id: dbId,
      filter,
      start_cursor: cursor,
      page_size: 100,
    });
    results.push(...resp.results);
    cursor = resp.has_more ? resp.next_cursor : undefined;
  } while (cursor);

  return results.map((page: any) => {
    const p = page.properties;
    return {
      id: page.id,
      title: extractPlainText(p["Title"]?.title),
      status: p["Status"]?.select?.name ?? "unprocessed",
      notePageUrl: p["Note page"]?.url ?? null,
      projectIds: (p["Project"]?.relation ?? []).map((r: any) => r.id),
    };
  });
}

export async function getMeetingNote(notion: NotionClient, noteId: string) {
  const page: any = await notion.pages.retrieve({ page_id: noteId });
  const props = page.properties;
  const notePageUrl: string | null = props["Note page"]?.url ?? null;

  // Content lives in the linked page (Note page URL), not in this entry.
  // Try the linked page first, fall back to this entry's own body.
  let transcript = "";

  if (notePageUrl) {
    const linkedPageId = extractPageIdFromUrl(notePageUrl);
    if (linkedPageId) {
      transcript = await extractPageContent(notion, linkedPageId);
    }
  }

  if (!transcript) {
    transcript = await extractPageContent(notion, noteId);
  }

  return {
    id: page.id as string,
    title: extractPlainText(props["Title"]?.title),
    transcript,
    status: props["Status"]?.select?.name ?? "unprocessed",
    notePageUrl,
    projectIds: (props["Project"]?.relation ?? []).map((r: any) => r.id),
    processed: props["Status"]?.select?.name === "processed",
  };
}

/** Extract a Notion page ID from a notion.so URL. */
function extractPageIdFromUrl(url: string): string | null {
  // Handles: https://www.notion.so/Page-Title-abc123def456...
  // and:     https://www.notion.so/abc123def456...
  const match = url.match(/([a-f0-9]{32})(?:\?|$)/);
  if (match) {
    const raw = match[1];
    // Format as UUID: 8-4-4-4-12
    return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`;
  }
  // Already has dashes
  const uuidMatch = url.match(/([a-f0-9-]{36})/);
  return uuidMatch ? uuidMatch[1] : null;
}

/** Read all text blocks from a Notion page body and concatenate. */
async function extractPageContent(
  notion: NotionClient,
  pageId: string,
): Promise<string> {
  const parts: string[] = [];
  let cursor: string | undefined;

  do {
    const resp: any = await notion.blocks.children.list({
      block_id: pageId,
      page_size: 100,
    });

    for (const block of resp.results) {
      const btype = block.type;
      const content = block[btype];
      if (content?.rich_text) {
        const text = extractPlainText(content.rich_text);
        if (text) parts.push(text);
      }
    }

    cursor = resp.has_more ? resp.next_cursor : undefined;
  } while (cursor);

  return parts.join("\n");
}

export async function updateMeetingNoteStatus(
  notion: NotionClient,
  noteId: string,
  status: "unprocessed" | "processing" | "processed" | "failed",
  failureReason?: string,
) {
  const properties: Record<string, any> = {
    Status: { select: { name: status } },
  };
  if (status === "processed" || status === "failed") {
    properties["Last Processed at"] = {
      date: { start: new Date().toISOString() },
    };
  }
  if (failureReason) {
    properties["Failure reason"] = {
      rich_text: richTextPlain(failureReason),
    };
  }
  await notion.pages.update({ page_id: noteId, properties });
}

// ---------------------------------------------------------------------------
// B. Project Log — the knowledge nodes (output layer)
//
// Schema: Project (title), Summary (rich_text), Type (select),
//         Last Updated (date), Meeting Notes (relation)
// ---------------------------------------------------------------------------

export async function getProjectLogs(
  notion: NotionClient,
  dbId: string,
  _domain?: string,
): Promise<KnowledgeNode[]> {
  const results: any[] = [];
  let cursor: string | undefined;

  do {
    const resp: any = await notion.databases.query({
      database_id: dbId,
      start_cursor: cursor,
      page_size: 100,
    });
    results.push(...resp.results);
    cursor = resp.has_more ? resp.next_cursor : undefined;
  } while (cursor);

  return results.map(pageToKnowledgeNode);
}

function pageToKnowledgeNode(page: any): KnowledgeNode {
  const p = page.properties;
  return {
    id: page.id,
    name: extractPlainText(p["Project"]?.title),
    type: (p["Type"]?.select?.name ?? "concept") as NodeType,
    summary: extractPlainText(p["Summary"]?.rich_text),
    parentId: undefined,
    confidence: 0.5,
    domain: "general",
    lastUpdated:
      p["Last Updated"]?.date?.start ?? new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// C. Update Project Log — write back summary (the "soul" of the product)
// ---------------------------------------------------------------------------

export async function updateProjectSummary(
  notion: NotionClient,
  pageId: string,
  newSummary: string,
  _confidence?: number,
) {
  await notion.pages.update({
    page_id: pageId,
    properties: {
      Summary: { rich_text: richTextPlain(newSummary) },
      "Last Updated": { date: { start: new Date().toISOString() } },
    },
  });
}

export async function createProjectLogEntry(
  notion: NotionClient,
  dbId: string,
  node: {
    name: string;
    type: NodeType;
    summary: string;
    parentId?: string;
    sourceNoteId?: string;
    confidence: number;
    domain: string;
  },
): Promise<string> {
  const properties: Record<string, any> = {
    Project: { title: richTextPlain(node.name) },
    Type: { select: { name: node.type } },
    Summary: { rich_text: richTextPlain(node.summary) },
    "Last Updated": { date: { start: new Date().toISOString() } },
  };
  if (node.sourceNoteId) {
    properties["Meeting Notes"] = {
      relation: [{ id: node.sourceNoteId }],
    };
  }

  const page = await notion.pages.create({
    parent: { database_id: dbId },
    properties,
  });
  return page.id;
}

// ---------------------------------------------------------------------------
// Relationships
// ---------------------------------------------------------------------------

export async function queryAllRelationships(
  notion: NotionClient,
  dbId: string,
): Promise<Relationship[]> {
  const results: any[] = [];
  let cursor: string | undefined;

  do {
    const resp: any = await notion.databases.query({
      database_id: dbId,
      start_cursor: cursor,
      page_size: 100,
    });
    results.push(...resp.results);
    cursor = resp.has_more ? resp.next_cursor : undefined;
  } while (cursor);

  return results.map(pageToRelationship);
}

function pageToRelationship(page: any): Relationship {
  const p = page.properties;
  return {
    id: page.id,
    sourceId: p["Source Node"]?.relation?.[0]?.id ?? "",
    targetId: p["Target Node"]?.relation?.[0]?.id ?? "",
    relationshipType: (p["Relationship Type"]?.select?.name ??
      "related_to") as RelationshipType,
    evidence: extractPlainText(p["Evidence"]?.rich_text),
    confidence: p["Confidence"]?.number ?? 0.5,
  };
}

export async function createRelationship(
  notion: NotionClient,
  dbId: string,
  rel: {
    sourceId: string;
    targetId: string;
    relationshipType: RelationshipType;
    evidence: string;
    confidence: number;
    sourceName: string;
    targetName: string;
  },
): Promise<string> {
  const page = await notion.pages.create({
    parent: { database_id: dbId },
    properties: {
      Name: {
        title: richTextPlain(`${rel.sourceName} → ${rel.targetName}`),
      },
      "Source Node": { relation: [{ id: rel.sourceId }] },
      "Target Node": { relation: [{ id: rel.targetId }] },
      "Relationship Type": { select: { name: rel.relationshipType } },
      Evidence: { rich_text: richTextPlain(rel.evidence) },
      Confidence: { number: rel.confidence },
    },
  });
  return page.id;
}

// ---------------------------------------------------------------------------
// Change Log (optional)
// ---------------------------------------------------------------------------

export async function logChange(
  notion: NotionClient,
  dbId: string | undefined,
  entry: {
    nodeId: string;
    nodeName: string;
    changeType: string;
    sourceNoteId: string;
  },
) {
  if (!dbId) return;
  await notion.pages.create({
    parent: { database_id: dbId },
    properties: {
      Entry: {
        title: richTextPlain(`${entry.changeType}: ${entry.nodeName}`),
      },
      Date: { date: { start: new Date().toISOString() } },
      "Updated Node": { relation: [{ id: entry.nodeId }] },
      "Change Type": { select: { name: entry.changeType } },
      "Source Note": { relation: [{ id: entry.sourceNoteId }] },
    },
  });
}

// ---------------------------------------------------------------------------
// Recall Paths (optional)
// ---------------------------------------------------------------------------

export async function saveRecallPath(
  notion: NotionClient,
  dbId: string | undefined,
  recall: {
    question: string;
    pathNodesJson: string;
    explanation: string;
    sourceEvidence: string;
  },
) {
  if (!dbId) return;
  await notion.pages.create({
    parent: { database_id: dbId },
    properties: {
      Question: { title: richTextPlain(recall.question) },
      "Path Nodes": { rich_text: richTextPlain(recall.pathNodesJson) },
      Explanation: { rich_text: richTextPlain(recall.explanation) },
      "Source Evidence": {
        rich_text: richTextPlain(recall.sourceEvidence),
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Fuzzy matching
// ---------------------------------------------------------------------------

export function findBestMatch(
  name: string,
  existingNodes: KnowledgeNode[],
  threshold = 0.6,
): KnowledgeNode | null {
  const normalised = name.toLowerCase().trim();
  let best: KnowledgeNode | null = null;
  let bestScore = 0;

  for (const node of existingNodes) {
    const score = similarity(normalised, node.name.toLowerCase().trim());
    if (score > bestScore && score >= threshold) {
      bestScore = score;
      best = node;
    }
  }
  return best;
}

function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;

  const bigramsA = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) {
    const bigram = a.substring(i, i + 2);
    bigramsA.set(bigram, (bigramsA.get(bigram) ?? 0) + 1);
  }

  let intersectionSize = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const bigram = b.substring(i, i + 2);
    const count = bigramsA.get(bigram);
    if (count && count > 0) {
      bigramsA.set(bigram, count - 1);
      intersectionSize++;
    }
  }

  return (2 * intersectionSize) / (a.length - 1 + (b.length - 1));
}
