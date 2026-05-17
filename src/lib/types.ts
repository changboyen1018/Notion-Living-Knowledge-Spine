// ---------------------------------------------------------------------------
// Domain types for the Living Knowledge Spine
//
// Using `type` aliases (not `interface`) so they satisfy the SDK's JSONValue
// index signature constraint when returned from tool execute handlers.
// ---------------------------------------------------------------------------

export type NodeType =
  | "system"
  | "component"
  | "concept"
  | "decision"
  | "question";

export type RelationshipType =
  | "depends_on"
  | "feeds_into"
  | "owned_by"
  | "blocked_by"
  | "related_to"
  | "part_of";

export type ChangeType = "created" | "updated" | "merged" | "linked";

export type SourceType = "voice" | "meeting" | "manual" | "slack";

// --- Extraction output (from OpenAI) ----------------------------------------

export type ExtractedConcept = {
  name: string;
  type: NodeType;
  summary: string;
  parentName?: string;
};

export type ExtractedRelationship = {
  sourceName: string;
  targetName: string;
  relationshipType: RelationshipType;
  evidence: string;
};

export type ExtractionResult = {
  concepts: ExtractedConcept[];
  relationships: ExtractedRelationship[];
  openQuestions: string[];
  domain: string;
};

// --- In-memory graph representations ----------------------------------------

export type KnowledgeNode = {
  id: string;
  name: string;
  type: NodeType;
  summary: string;
  parentId?: string;
  confidence: number;
  domain: string;
  lastUpdated: string;
};

export type Relationship = {
  id: string;
  sourceId: string;
  targetId: string;
  relationshipType: RelationshipType;
  evidence: string;
  confidence: number;
};

export type RecallPathStep = {
  nodeId: string;
  nodeName: string;
  nodeType: NodeType;
  summary: string;
  depth: number;
};

export type RecallPath = {
  question: string;
  steps: RecallPathStep[];
  explanation: string;
  sourceEvidence: string[];
};

// --- Change tracking --------------------------------------------------------

export type ChangeRecord = {
  nodeId: string;
  nodeName: string;
  changeType: ChangeType;
  details: string;
};

export type SpineUpdateResult = {
  noteId: string;
  domain: string;
  nodesCreated: number;
  nodesUpdated: number;
  relationshipsCreated: number;
  openQuestions: string[];
  changes: ChangeRecord[];
};

// --- Knowledge gap detection ------------------------------------------------

export type KnowledgeGap = {
  type:
    | "low_confidence"
    | "no_children"
    | "orphan"
    | "open_question"
    | "stale";
  nodeId?: string;
  nodeName?: string;
  description: string;
  recommendation: string;
};
