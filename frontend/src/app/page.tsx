"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import dynamic from "next/dynamic";

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false,
});

type GraphNode = {
  id: string;
  name: string;
  summary: string;
  type: string;
  status?: string;
  lastUpdated: string | null;
  group: string;
  x?: number;
  y?: number;
};

type GraphLink = {
  source: string | GraphNode;
  target: string | GraphNode;
  type: string;
  evidence: string;
  confidence: number;
};

type GraphData = {
  nodes: GraphNode[];
  links: GraphLink[];
  fetchedAt: string;
};

const TYPE_COLORS: Record<string, string> = {
  system: "#58a6ff",
  component: "#3fb950",
  concept: "#d2a8ff",
  decision: "#f0883e",
  question: "#f85149",
  action_item: "#79c0ff",
};

const STATUS_COLORS: Record<string, string> = {
  "Not started": "#8b949e",
  "In progress": "#d29922",
  Done: "#3fb950",
};

const LINK_COLORS: Record<string, string> = {
  depends_on: "#f0883e",
  feeds_into: "#3fb950",
  owned_by: "#58a6ff",
  blocked_by: "#f85149",
  related_to: "#8b949e",
  part_of: "#d2a8ff",
  has_action: "#30363d",
};

export default function Home() {
  const [data, setData] = useState<GraphData | null>(null);
  const [hovered, setHovered] = useState<GraphNode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<string>("");
  const fgRef = useRef<any>(null);

  const fetchGraph = useCallback(async () => {
    try {
      const res = await fetch("/api/graph");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      setLastRefresh(new Date().toLocaleTimeString());
      setError(null);
    } catch (err: any) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    fetchGraph();
    const interval = setInterval(fetchGraph, 10_000);
    return () => clearInterval(interval);
  }, [fetchGraph]);

  const nodeCanvasObject = useCallback(
    (node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const label = node.name || "?";
      const isAction = node.group === "action";
      const isHovered = hovered?.id === node.id;
      const fontSize = Math.max(12 / globalScale, 3);

      let color: string;
      if (isAction) {
        color = STATUS_COLORS[node.status ?? "Not started"] ?? "#8b949e";
      } else {
        color = TYPE_COLORS[node.type] ?? "#8b949e";
      }

      const r = isAction ? (isHovered ? 5 : 3) : isHovered ? 10 : 7;

      if (isHovered) {
        ctx.shadowColor = color;
        ctx.shadowBlur = 20;
      }

      ctx.beginPath();
      if (isAction) {
        // Square for action items
        ctx.rect(node.x - r, node.y - r, r * 2, r * 2);
      } else {
        ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
      }
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = isHovered ? "#ffffff" : "rgba(255,255,255,0.2)";
      ctx.lineWidth = isHovered ? 2 / globalScale : 0.5 / globalScale;
      ctx.stroke();

      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;

      // Label
      const maxLabelLen = isAction ? 25 : 40;
      const displayLabel =
        label.length > maxLabelLen
          ? label.slice(0, maxLabelLen - 2) + "…"
          : label;
      ctx.font = `${isHovered ? "bold " : ""}${fontSize * (isAction ? 0.85 : 1)}px -apple-system, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = isHovered
        ? "#ffffff"
        : isAction
          ? "rgba(200,210,220,0.6)"
          : "rgba(230,237,243,0.85)";
      ctx.fillText(displayLabel, node.x, node.y + r + 2);
    },
    [hovered],
  );

  const linkColor = useCallback((link: any) => {
    const base = LINK_COLORS[link.type] ?? "#8b949e";
    return link.type === "has_action" ? base + "44" : base + "88";
  }, []);

  if (error && !data) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <div style={{ fontSize: 18, color: "#f85149" }}>
          Failed to load graph
        </div>
        <div style={{ fontSize: 14, color: "#8b949e" }}>{error}</div>
        <button
          onClick={fetchGraph}
          style={{
            background: "#21262d",
            color: "#e6edf3",
            border: "1px solid #30363d",
            borderRadius: 6,
            padding: "8px 16px",
            cursor: "pointer",
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  if (!data) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          gap: 8,
        }}
      >
        <div
          style={{
            width: 20,
            height: 20,
            border: "2px solid #30363d",
            borderTopColor: "#58a6ff",
            borderRadius: "50%",
            animation: "spin 1s linear infinite",
          }}
        />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        <span style={{ color: "#8b949e" }}>Loading knowledge graph…</span>
      </div>
    );
  }

  const projectCount = data.nodes.filter((n) => n.group === "project").length;
  const actionCount = data.nodes.filter((n) => n.group === "action").length;

  return (
    <div style={{ position: "relative", width: "100vw", height: "100vh" }}>
      {/* Header */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 10,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 16px",
          background:
            "linear-gradient(180deg, rgba(13,17,23,0.95) 0%, rgba(13,17,23,0) 100%)",
          pointerEvents: "none",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 18 }}>🧬</span>
          <span style={{ fontSize: 14, fontWeight: 600 }}>
            Living Knowledge Spine
          </span>
          <span
            style={{
              fontSize: 11,
              color: "#3fb950",
              background: "rgba(63,185,80,0.15)",
              padding: "2px 8px",
              borderRadius: 10,
            }}
          >
            ● LIVE
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span style={{ fontSize: 11, color: "#8b949e" }}>
            {projectCount} projects · {actionCount} actions · {data.links.length}{" "}
            edges
          </span>
          <span style={{ fontSize: 11, color: "#8b949e" }}>
            ↻ {lastRefresh}
          </span>
        </div>
      </div>

      {/* Legend */}
      <div
        style={{
          position: "absolute",
          bottom: 12,
          left: 12,
          zIndex: 10,
          display: "flex",
          gap: 14,
          background: "rgba(13,17,23,0.85)",
          padding: "6px 12px",
          borderRadius: 8,
          border: "1px solid #21262d",
          fontSize: 11,
          flexWrap: "wrap",
        }}
      >
        {Object.entries(TYPE_COLORS).map(([type, color]) => (
          <div
            key={type}
            style={{ display: "flex", alignItems: "center", gap: 4 }}
          >
            <div
              style={{
                width: type === "action_item" ? 7 : 8,
                height: type === "action_item" ? 7 : 8,
                borderRadius: type === "action_item" ? 1 : "50%",
                background: color,
              }}
            />
            <span style={{ color: "#8b949e" }}>
              {type === "action_item" ? "action" : type}
            </span>
          </div>
        ))}
      </div>

      {/* Hover tooltip */}
      {hovered && (
        <div
          style={{
            position: "absolute",
            top: 56,
            right: 12,
            zIndex: 10,
            width: 300,
            background: "rgba(22,27,34,0.95)",
            border: "1px solid #30363d",
            borderRadius: 8,
            padding: 16,
            backdropFilter: "blur(8px)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 8,
            }}
          >
            <div
              style={{
                width: 10,
                height: 10,
                borderRadius:
                  hovered.group === "action" ? 2 : "50%",
                background:
                  hovered.group === "action"
                    ? STATUS_COLORS[hovered.status ?? "Not started"] ??
                      "#8b949e"
                    : TYPE_COLORS[hovered.type] ?? "#8b949e",
              }}
            />
            <span style={{ fontSize: 14, fontWeight: 600 }}>
              {hovered.name}
            </span>
          </div>

          <div
            style={{
              display: "flex",
              gap: 8,
              marginBottom: 8,
              fontSize: 11,
            }}
          >
            <span
              style={{
                color: "#8b949e",
                textTransform: "uppercase",
                letterSpacing: 1,
                background: "rgba(139,148,158,0.1)",
                padding: "2px 6px",
                borderRadius: 4,
              }}
            >
              {hovered.group === "action" ? "action item" : hovered.type}
            </span>
            {hovered.status && (
              <span
                style={{
                  color:
                    STATUS_COLORS[hovered.status] ?? "#8b949e",
                  background: `${STATUS_COLORS[hovered.status] ?? "#8b949e"}22`,
                  padding: "2px 6px",
                  borderRadius: 4,
                }}
              >
                {hovered.status}
              </span>
            )}
          </div>

          <div
            style={{
              fontSize: 13,
              color: "#c9d1d9",
              lineHeight: 1.5,
              maxHeight: 150,
              overflow: "auto",
            }}
          >
            {hovered.summary || "No summary yet."}
          </div>

          {hovered.lastUpdated && (
            <div style={{ fontSize: 11, color: "#484f58", marginTop: 8 }}>
              Updated:{" "}
              {new Date(hovered.lastUpdated).toLocaleDateString()}
            </div>
          )}
        </div>
      )}

      {/* Graph */}
      <ForceGraph2D
        ref={fgRef}
        graphData={data}
        nodeId="id"
        nodeCanvasObject={nodeCanvasObject}
        nodePointerAreaPaint={(node: any, color, ctx) => {
          ctx.beginPath();
          ctx.arc(node.x, node.y, 12, 0, 2 * Math.PI);
          ctx.fillStyle = color;
          ctx.fill();
        }}
        linkColor={linkColor}
        linkWidth={(link: any) =>
          link.type === "has_action" ? 0.5 : 1.5
        }
        linkDirectionalArrowLength={(link: any) =>
          link.type === "has_action" ? 0 : 4
        }
        linkDirectionalArrowRelPos={0.85}
        linkCurvature={0.15}
        onNodeHover={(node: any) => setHovered(node ?? null)}
        backgroundColor="#0d1117"
        width={typeof window !== "undefined" ? window.innerWidth : 800}
        height={typeof window !== "undefined" ? window.innerHeight : 600}
        cooldownTicks={100}
        d3AlphaDecay={0.02}
        d3VelocityDecay={0.3}
      />
    </div>
  );
}
