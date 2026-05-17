// ---------------------------------------------------------------------------
// Concept & relationship extraction from raw note text.
//
// Primary path: OpenAI API (structured JSON output via function calling).
// Fallback: naive keyword-based extraction for environments without an API key.
// ---------------------------------------------------------------------------

import type {
  ExtractionResult,
  ExtractedConcept,
  ExtractedRelationship,
  NodeType,
  RelationshipType,
} from "./types.js";

const OPENAI_ENDPOINT = "https://api.openai.com/v1/chat/completions";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function extractFromNote(
  rawText: string,
  existingNodeNames: string[],
  domain?: string,
): Promise<ExtractionResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey) {
    try {
      return await extractWithOpenAI(rawText, existingNodeNames, domain, apiKey);
    } catch (err) {
      console.warn("OpenAI extraction failed, falling back to keyword extraction:", err);
    }
  }
  return extractWithKeywords(rawText, domain);
}

// ---------------------------------------------------------------------------
// OpenAI extraction
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a knowledge-graph extraction engine. Given a messy note (voice transcript, meeting note, or learning log), extract structured knowledge.

Return a JSON object with exactly these fields:
- "concepts": array of objects with { "name": string, "type": "system"|"component"|"concept"|"decision"|"question", "summary": string, "parentName": string|null }
- "relationships": array of objects with { "sourceName": string, "targetName": string, "relationshipType": "depends_on"|"feeds_into"|"owned_by"|"blocked_by"|"related_to"|"part_of", "evidence": string }
- "openQuestions": array of strings — things the author is uncertain about or wants to learn
- "domain": string — the broad domain this note belongs to

Rules:
1. Concept names should be concise noun phrases (e.g. "Feature Extractor", "Risk Scoring Pipeline").
2. Reuse existing concept names when the note refers to something already known. The caller provides a list of existing names.
3. Mark concepts as "question" type when the note expresses uncertainty.
4. Relationships should capture directional dependencies — data flow, ownership, blocking.
5. Keep summaries to 1–2 sentences.
6. Return ONLY valid JSON, no markdown fences.`;

async function extractWithOpenAI(
  rawText: string,
  existingNodeNames: string[],
  domain: string | undefined,
  apiKey: string,
): Promise<ExtractionResult> {
  const userMessage = [
    domain ? `Domain context: ${domain}` : "",
    existingNodeNames.length
      ? `Existing concepts in the knowledge graph:\n${existingNodeNames.map((n) => `- ${n}`).join("\n")}`
      : "",
    `\n--- RAW NOTE ---\n${rawText}\n--- END NOTE ---`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const body = {
    model: "gpt-4o-mini",
    temperature: 0.2,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ],
    response_format: { type: "json_object" },
  };

  const resp = await fetch(OPENAI_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`OpenAI API ${resp.status}: ${errText}`);
  }

  const json: any = await resp.json();
  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new Error("Empty response from OpenAI");

  const parsed = JSON.parse(content);
  return validateExtractionResult(parsed);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const VALID_NODE_TYPES = new Set<NodeType>([
  "system",
  "component",
  "concept",
  "decision",
  "question",
]);

const VALID_REL_TYPES = new Set<RelationshipType>([
  "depends_on",
  "feeds_into",
  "owned_by",
  "blocked_by",
  "related_to",
  "part_of",
]);

function validateExtractionResult(raw: any): ExtractionResult {
  const concepts: ExtractedConcept[] = (raw.concepts ?? []).map((c: any) => ({
    name: String(c.name ?? "").trim(),
    type: VALID_NODE_TYPES.has(c.type) ? c.type : "concept",
    summary: String(c.summary ?? ""),
    parentName: c.parentName ? String(c.parentName).trim() : undefined,
  }));

  const relationships: ExtractedRelationship[] = (raw.relationships ?? []).map(
    (r: any) => ({
      sourceName: String(r.sourceName ?? "").trim(),
      targetName: String(r.targetName ?? "").trim(),
      relationshipType: VALID_REL_TYPES.has(r.relationshipType)
        ? r.relationshipType
        : "related_to",
      evidence: String(r.evidence ?? ""),
    }),
  );

  const openQuestions: string[] = (raw.openQuestions ?? []).map((q: any) =>
    String(q),
  );

  return {
    concepts: concepts.filter((c) => c.name.length > 0),
    relationships: relationships.filter(
      (r) => r.sourceName.length > 0 && r.targetName.length > 0,
    ),
    openQuestions,
    domain: String(raw.domain ?? "general"),
  };
}

// ---------------------------------------------------------------------------
// Fallback: keyword-based extraction
// ---------------------------------------------------------------------------

const COMPONENT_INDICATORS = [
  "pipeline",
  "engine",
  "service",
  "module",
  "layer",
  "extractor",
  "generator",
  "aggregator",
  "model",
  "validator",
  "processor",
  "handler",
  "manager",
  "controller",
  "api",
  "database",
  "queue",
  "cache",
];

const RELATIONSHIP_SIGNALS: Array<{
  pattern: RegExp;
  type: RelationshipType;
}> = [
  { pattern: /feeds?\s+into/i, type: "feeds_into" },
  { pattern: /depends?\s+on/i, type: "depends_on" },
  { pattern: /part\s+of/i, type: "part_of" },
  { pattern: /owned?\s+by/i, type: "owned_by" },
  { pattern: /blocked?\s+by/i, type: "blocked_by" },
  { pattern: /connects?\s+to/i, type: "related_to" },
  { pattern: /goes?\s+(?:in)?to/i, type: "feeds_into" },
  { pattern: /outputs?\s+to/i, type: "feeds_into" },
  { pattern: /uses?/i, type: "depends_on" },
];

function extractWithKeywords(
  rawText: string,
  domain?: string,
): ExtractionResult {
  const sentences = rawText
    .split(/[.!?\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 5);

  const conceptSet = new Map<string, ExtractedConcept>();
  const relationships: ExtractedRelationship[] = [];
  const openQuestions: string[] = [];

  for (const sentence of sentences) {
    if (sentence.match(/\?|don't.*understand|not sure|unclear|need to learn/i)) {
      openQuestions.push(sentence);
    }

    const words = sentence.split(/\s+/);
    for (let i = 0; i < words.length - 1; i++) {
      const twoWord = `${words[i]} ${words[i + 1]}`.replace(/[^a-zA-Z\s]/g, "");
      const lower = twoWord.toLowerCase();
      if (COMPONENT_INDICATORS.some((ind) => lower.includes(ind))) {
        const name = capitalise(twoWord);
        if (!conceptSet.has(name.toLowerCase())) {
          conceptSet.set(name.toLowerCase(), {
            name,
            type: "component",
            summary: sentence,
          });
        }
      }
    }

    for (const { pattern, type } of RELATIONSHIP_SIGNALS) {
      const match = sentence.match(pattern);
      if (match && match.index !== undefined) {
        const before = sentence.slice(0, match.index).trim();
        const after = sentence.slice(match.index + match[0].length).trim();
        const src = lastNounPhrase(before);
        const tgt = firstNounPhrase(after);
        if (src && tgt) {
          relationships.push({
            sourceName: src,
            targetName: tgt,
            relationshipType: type,
            evidence: sentence,
          });
        }
      }
    }
  }

  return {
    concepts: Array.from(conceptSet.values()),
    relationships,
    openQuestions,
    domain: domain ?? "general",
  };
}

function capitalise(s: string): string {
  return s
    .split(" ")
    .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function lastNounPhrase(s: string): string | null {
  const words = s.split(/\s+/).filter((w) => w.length > 1);
  if (words.length === 0) return null;
  const phrase = words.slice(-Math.min(3, words.length)).join(" ");
  return capitalise(phrase.replace(/[^a-zA-Z\s]/g, "").trim()) || null;
}

function firstNounPhrase(s: string): string | null {
  const words = s.split(/\s+/).filter((w) => w.length > 1);
  if (words.length === 0) return null;
  const phrase = words.slice(0, Math.min(3, words.length)).join(" ");
  return capitalise(phrase.replace(/[^a-zA-Z\s]/g, "").trim()) || null;
}
