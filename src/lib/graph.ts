// ---------------------------------------------------------------------------
// In-memory graph construction and traversal for knowledge recall paths.
//
// Builds an adjacency-list graph from KnowledgeNode[] and Relationship[],
// then provides BFS path-finding and root detection.
// ---------------------------------------------------------------------------

import type {
  KnowledgeNode,
  Relationship,
  RecallPathStep,
  KnowledgeGap,
} from "./types.js";

// ---------------------------------------------------------------------------
// Graph structure
// ---------------------------------------------------------------------------

interface GraphEdge {
  targetId: string;
  relationshipType: string;
  evidence: string;
}

export class KnowledgeGraph {
  private nodes: Map<string, KnowledgeNode>;
  private adjacency: Map<string, GraphEdge[]>;
  private reverseAdjacency: Map<string, GraphEdge[]>;
  private nameIndex: Map<string, string>; // lowercase name -> node id

  constructor(nodes: KnowledgeNode[], relationships: Relationship[]) {
    this.nodes = new Map();
    this.adjacency = new Map();
    this.reverseAdjacency = new Map();
    this.nameIndex = new Map();

    for (const node of nodes) {
      this.nodes.set(node.id, node);
      this.adjacency.set(node.id, []);
      this.reverseAdjacency.set(node.id, []);
      this.nameIndex.set(node.name.toLowerCase(), node.id);
    }

    for (const rel of relationships) {
      if (!this.nodes.has(rel.sourceId) || !this.nodes.has(rel.targetId)) {
        continue;
      }

      this.adjacency.get(rel.sourceId)!.push({
        targetId: rel.targetId,
        relationshipType: rel.relationshipType,
        evidence: rel.evidence,
      });

      this.reverseAdjacency.get(rel.targetId)!.push({
        targetId: rel.sourceId,
        relationshipType: rel.relationshipType,
        evidence: rel.evidence,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  getNode(id: string): KnowledgeNode | undefined {
    return this.nodes.get(id);
  }

  findNodeByName(name: string): KnowledgeNode | undefined {
    const id = this.nameIndex.get(name.toLowerCase());
    return id ? this.nodes.get(id) : undefined;
  }

  /** Search nodes whose name contains the query (case-insensitive). */
  searchNodes(query: string): KnowledgeNode[] {
    const lower = query.toLowerCase();
    const results: KnowledgeNode[] = [];
    for (const node of this.nodes.values()) {
      if (node.name.toLowerCase().includes(lower)) {
        results.push(node);
      }
    }
    return results;
  }

  /** Nodes with no incoming edges — top-level systems/concepts. */
  getRoots(): KnowledgeNode[] {
    const roots: KnowledgeNode[] = [];
    for (const [id, edges] of this.reverseAdjacency) {
      if (edges.length === 0) {
        const node = this.nodes.get(id);
        if (node) roots.push(node);
      }
    }
    // Also include nodes explicitly typed as "system"
    for (const node of this.nodes.values()) {
      if (node.type === "system" && !roots.find((r) => r.id === node.id)) {
        roots.push(node);
      }
    }
    return roots;
  }

  getChildren(nodeId: string): KnowledgeNode[] {
    const edges = this.adjacency.get(nodeId) ?? [];
    return edges
      .map((e) => this.nodes.get(e.targetId))
      .filter((n): n is KnowledgeNode => n !== undefined);
  }

  getParents(nodeId: string): KnowledgeNode[] {
    const edges = this.reverseAdjacency.get(nodeId) ?? [];
    return edges
      .map((e) => this.nodes.get(e.targetId))
      .filter((n): n is KnowledgeNode => n !== undefined);
  }

  getAllNodes(): KnowledgeNode[] {
    return Array.from(this.nodes.values());
  }

  getEdgesFrom(nodeId: string): GraphEdge[] {
    return this.adjacency.get(nodeId) ?? [];
  }

  // -------------------------------------------------------------------------
  // BFS: find path from any root to a target node
  // -------------------------------------------------------------------------

  findPathToNode(targetId: string): RecallPathStep[] {
    const target = this.nodes.get(targetId);
    if (!target) return [];

    // Walk up from target via reverse adjacency to find a root
    const path = this.bfsToRoot(targetId);
    if (path.length === 0) {
      // No path to root — just return the target itself
      return [nodeToStep(target, 0)];
    }

    return path.map((id, idx) => {
      const node = this.nodes.get(id)!;
      return nodeToStep(node, idx);
    });
  }

  /** BFS upward from a node to the nearest root, returns path root→target. */
  private bfsToRoot(startId: string): string[] {
    const visited = new Set<string>([startId]);
    const parent = new Map<string, string>();
    const queue: string[] = [startId];

    while (queue.length > 0) {
      const current = queue.shift()!;

      // Check if we've reached a root
      const incomingEdges = this.reverseAdjacency.get(current) ?? [];
      const isRoot =
        incomingEdges.length === 0 ||
        this.nodes.get(current)?.type === "system";

      if (isRoot && current !== startId) {
        return this.reconstructPath(parent, startId, current);
      }

      for (const edge of incomingEdges) {
        if (!visited.has(edge.targetId)) {
          visited.add(edge.targetId);
          parent.set(edge.targetId, current);
          queue.push(edge.targetId);
        }
      }
    }

    return [startId];
  }

  private reconstructPath(
    parentMap: Map<string, string>,
    start: string,
    end: string,
  ): string[] {
    const path: string[] = [end];
    let current = end;
    while (current !== start) {
      const prev = parentMap.get(current);
      if (!prev) break;
      path.push(prev);
      current = prev;
    }
    // Path is end→start, but we want root→target
    return path;
  }

  // -------------------------------------------------------------------------
  // BFS: build spine subtree from a node downward
  // -------------------------------------------------------------------------

  buildSubtree(
    rootId: string,
    maxDepth = 5,
  ): RecallPathStep[] {
    const result: RecallPathStep[] = [];
    const visited = new Set<string>();
    const queue: Array<{ id: string; depth: number }> = [
      { id: rootId, depth: 0 },
    ];

    while (queue.length > 0) {
      const { id, depth } = queue.shift()!;
      if (visited.has(id) || depth > maxDepth) continue;
      visited.add(id);

      const node = this.nodes.get(id);
      if (!node) continue;

      result.push(nodeToStep(node, depth));

      for (const edge of this.adjacency.get(id) ?? []) {
        if (!visited.has(edge.targetId)) {
          queue.push({ id: edge.targetId, depth: depth + 1 });
        }
      }
    }

    return result;
  }

  // -------------------------------------------------------------------------
  // Gap detection
  // -------------------------------------------------------------------------

  detectGaps(staleDays = 14): KnowledgeGap[] {
    const gaps: KnowledgeGap[] = [];
    const now = Date.now();
    const staleMs = staleDays * 24 * 60 * 60 * 1000;

    for (const node of this.nodes.values()) {
      if (node.confidence < 0.4) {
        gaps.push({
          type: "low_confidence",
          nodeId: node.id,
          nodeName: node.name,
          description: `"${node.name}" has low confidence (${node.confidence}).`,
          recommendation: `Add more source notes or clarify understanding of "${node.name}".`,
        });
      }

      const children = this.adjacency.get(node.id) ?? [];
      const parents = this.reverseAdjacency.get(node.id) ?? [];
      if (children.length === 0 && parents.length === 0) {
        gaps.push({
          type: "orphan",
          nodeId: node.id,
          nodeName: node.name,
          description: `"${node.name}" has no connections to other concepts.`,
          recommendation: `Link "${node.name}" to related concepts or investigate if it belongs in a different domain.`,
        });
      } else if (
        children.length === 0 &&
        node.type !== "question" &&
        node.type !== "decision"
      ) {
        gaps.push({
          type: "no_children",
          nodeId: node.id,
          nodeName: node.name,
          description: `"${node.name}" is a leaf node with no sub-components.`,
          recommendation: `Consider if "${node.name}" should be decomposed into sub-concepts.`,
        });
      }

      if (node.type === "question") {
        gaps.push({
          type: "open_question",
          nodeId: node.id,
          nodeName: node.name,
          description: `Open question: "${node.summary || node.name}"`,
          recommendation: `Research and resolve this question to strengthen the knowledge spine.`,
        });
      }

      const updatedAt = new Date(node.lastUpdated).getTime();
      if (now - updatedAt > staleMs) {
        gaps.push({
          type: "stale",
          nodeId: node.id,
          nodeName: node.name,
          description: `"${node.name}" has not been updated in over ${staleDays} days.`,
          recommendation: `Review "${node.name}" — it may need refreshing or confirmation.`,
        });
      }
    }

    return gaps;
  }

  // -------------------------------------------------------------------------
  // Mermaid generation
  // -------------------------------------------------------------------------

  toMermaid(): string {
    const lines: string[] = ["graph TD"];
    const idMap = new Map<string, string>();
    let counter = 0;

    const mermaidId = (nodeId: string): string => {
      if (!idMap.has(nodeId)) {
        idMap.set(nodeId, `N${counter++}`);
      }
      return idMap.get(nodeId)!;
    };

    for (const node of this.nodes.values()) {
      const mid = mermaidId(node.id);
      const label = node.name.replace(/"/g, "'");
      lines.push(`    ${mid}["${label}"]`);
    }

    for (const [sourceId, edges] of this.adjacency) {
      for (const edge of edges) {
        const srcMid = mermaidId(sourceId);
        const tgtMid = mermaidId(edge.targetId);
        const label = edge.relationshipType.replace(/_/g, " ");
        lines.push(`    ${srcMid} -->|"${label}"| ${tgtMid}`);
      }
    }

    return lines.join("\n");
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nodeToStep(node: KnowledgeNode, depth: number): RecallPathStep {
  return {
    nodeId: node.id,
    nodeName: node.name,
    nodeType: node.type,
    summary: node.summary,
    depth,
  };
}
