"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import dynamic from "next/dynamic";

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false,
});

type MeetingSource = { title: string; url: string };

type GraphNode = {
  id: string;
  name: string;
  shortName: string;
  summary: string;
  type: string;
  status?: string;
  lastUpdated: string | null;
  group: string;
  sources: MeetingSource[];
  notionUrl: string;
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

const STOP_WORDS = new Set([
  "the", "a", "an", "for", "to", "from", "with", "via", "by",
  "in", "on", "at", "of", "and", "or", "is", "be", "that",
  "this", "our", "we", "must", "should", "can", "will",
  "all", "per", "up", "set", "get", "has", "have", "been",
]);

function shorten(text: string, maxWords = 3): string {
  if (!text) return "?";
  const words = text
    .replace(/[—\-–]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0);

  const keywords = words.filter(
    (w) => !STOP_WORDS.has(w.toLowerCase()),
  );

  const pick = keywords.length > 0 ? keywords : words;
  const result = pick.slice(0, maxWords).join(" ");
  return result.charAt(0).toUpperCase() + result.slice(1);
}

export default function Home() {
  const [data, setData] = useState<GraphData | null>(null);
  const [hovered, setHovered] = useState<GraphNode | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState("");
  const fgRef = useRef<any>(null);

  const fetchGraph = useCallback(async () => {
    try {
      const res = await fetch("/api/graph");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();

      const nodes = json.nodes.map((n: any) => ({
        ...n,
        shortName:
          n.group === "action" ? shorten(n.name) : n.name,
        sources: n.sources ?? [],
        notionUrl: n.notionUrl ?? "",
      }));

      setData({ ...json, nodes });
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

  const filteredData = data
    ? {
        ...data,
        nodes: showDone
          ? data.nodes
          : data.nodes.filter(
              (n) => !(n.group === "action" && n.status === "Done"),
            ),
        links: showDone
          ? data.links
          : data.links.filter((l) => {
              const targetId =
                typeof l.target === "string"
                  ? l.target
                  : (l.target as GraphNode).id;
              return !data.nodes.some(
                (n) =>
                  n.id === targetId &&
                  n.group === "action" &&
                  n.status === "Done",
              );
            }),
      }
    : null;

  const nodeCanvasObject = useCallback(
    (node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const isAction = node.group === "action";
      const isHovered = hovered?.id === node.id;
      const isDone = node.status === "Done";
      const isInProgress = node.status === "In progress";
      const fontSize = Math.max(12 / globalScale, 3);

      let color: string;
      if (isAction) {
        color = isDone ? "#3fb950" : isInProgress ? "#d29922" : "#8b949e";
      } else {
        color = TYPE_COLORS[node.type] ?? "#d2a8ff";
      }

      const baseR = isAction ? 3.5 : 7;
      const r = isHovered ? baseR * 1.6 : baseR;

      if (isHovered) {
        ctx.shadowColor = color;
        ctx.shadowBlur = 20;
      }

      ctx.globalAlpha = isDone ? 0.45 : 1;
      ctx.beginPath();
      if (isAction) {
        ctx.rect(node.x - r, node.y - r, r * 2, r * 2);
      } else {
        ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
      }
      ctx.fillStyle = color;
      ctx.fill();

      if (isDone) {
        ctx.strokeStyle = "#0d1117";
        ctx.lineWidth = 1.5 / globalScale;
        const s = r * 0.5;
        ctx.beginPath();
        ctx.moveTo(node.x - s * 0.5, node.y);
        ctx.lineTo(node.x - s * 0.1, node.y + s * 0.4);
        ctx.lineTo(node.x + s * 0.5, node.y - s * 0.3);
        ctx.stroke();
      } else {
        ctx.strokeStyle = isHovered ? "#fff" : "rgba(255,255,255,0.2)";
        ctx.lineWidth = isHovered ? 2 / globalScale : 0.5 / globalScale;
        ctx.stroke();
      }

      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;

      if (isInProgress && !isHovered) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, r + 3, 0, 2 * Math.PI);
        ctx.strokeStyle = "#d2992244";
        ctx.lineWidth = 1 / globalScale;
        ctx.stroke();
      }

      const label = node.shortName || node.name;
      const maxLen = isAction ? 20 : 28;
      const displayLabel =
        label.length > maxLen ? label.slice(0, maxLen - 1) + "…" : label;

      ctx.font = `${isHovered ? "bold " : ""}${fontSize * (isAction ? 0.8 : 1)}px -apple-system, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = isHovered
        ? "#fff"
        : isDone
          ? "rgba(63,185,80,0.45)"
          : isAction
            ? "rgba(200,210,220,0.65)"
            : "rgba(230,237,243,0.85)";
      ctx.fillText(displayLabel, node.x, node.y + r + 2);
      ctx.globalAlpha = 1;
    },
    [hovered],
  );

  const linkColor = useCallback(
    (link: any) =>
      (LINK_COLORS[link.type] ?? "#8b949e") +
      (link.type === "has_action" ? "44" : "88"),
    [],
  );

  /* ---------- loading / error states ---------- */
  if (error && !data) {
    return (
      <div style={centerStyle}>
        <div style={{ fontSize: 18, color: "#f85149" }}>Failed to load</div>
        <div style={{ fontSize: 14, color: "#8b949e" }}>{error}</div>
        <button onClick={fetchGraph} style={btnStyle}>
          Retry
        </button>
      </div>
    );
  }

  if (!filteredData) {
    return (
      <div style={centerStyle}>
        <div style={spinnerStyle} />
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        <span style={{ color: "#8b949e" }}>Loading knowledge graph…</span>
      </div>
    );
  }

  const allNodes = data!.nodes;
  const projectCount = allNodes.filter((n) => n.group === "project").length;
  const inProg = allNodes.filter(
    (n) => n.group === "action" && n.status === "In progress",
  ).length;
  const done = allNodes.filter(
    (n) => n.group === "action" && n.status === "Done",
  ).length;
  const pending = allNodes.filter(
    (n) => n.group === "action" && n.status === "Not started",
  ).length;

  return (
    <div style={{ position: "relative", width: "100vw", height: "100vh" }}>
      {/* ---- Header ---- */}
      <div style={headerStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 18 }}>🧬</span>
          <span style={{ fontSize: 14, fontWeight: 600 }}>
            Living Knowledge Spine
          </span>
          <span style={liveBadge}>● LIVE</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 11, color: "#8b949e" }}>
            {projectCount} projects
          </span>
          <span style={{ fontSize: 11, color: "#d29922" }}>
            {inProg} in progress
          </span>
          <span style={{ fontSize: 11, color: "#3fb950" }}>{done} done</span>
          <span style={{ fontSize: 11, color: "#8b949e" }}>
            {pending} pending
          </span>
          <span style={{ fontSize: 11, color: "#484f58" }}>
            ↻ {lastRefresh}
          </span>
        </div>
      </div>

      {/* ---- Legend + toggle ---- */}
      <div style={legendStyle}>
        {[
          { l: "project", c: "#d2a8ff", s: "circle" },
          { l: "pending", c: "#8b949e", s: "square" },
          { l: "in progress", c: "#d29922", s: "square" },
          { l: "done", c: "#3fb950", s: "square" },
        ].map((i) => (
          <div key={i.l} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: i.s === "circle" ? "50%" : 1,
                background: i.c,
                opacity: i.l === "done" ? 0.5 : 1,
              }}
            />
            <span style={{ color: "#8b949e" }}>{i.l}</span>
          </div>
        ))}
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            cursor: "pointer",
            marginLeft: 8,
            pointerEvents: "auto",
          }}
        >
          <input
            type="checkbox"
            checked={showDone}
            onChange={(e) => setShowDone(e.target.checked)}
            style={{ accentColor: "#3fb950" }}
          />
          <span style={{ color: "#8b949e" }}>Show done</span>
        </label>
      </div>

      {/* ---- Hover tooltip ---- */}
      {hovered && (
        <div style={tooltipStyle}>
          {/* title row */}
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 6 }}>
            <div
              style={{
                width: 10,
                height: 10,
                flexShrink: 0,
                marginTop: 3,
                borderRadius: hovered.group === "action" ? 2 : "50%",
                background:
                  hovered.group === "action"
                    ? STATUS_COLORS[hovered.status ?? "Not started"] ?? "#8b949e"
                    : TYPE_COLORS[hovered.type] ?? "#d2a8ff",
              }}
            />
            <span style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.3 }}>
              {hovered.name}
            </span>
          </div>

          {/* badges */}
          <div style={{ display: "flex", gap: 6, marginBottom: 8, fontSize: 11 }}>
            <span style={tagBadge}>
              {hovered.group === "action" ? "action item" : hovered.type || "project"}
            </span>
            {hovered.status && (
              <span
                style={{
                  ...tagBadge,
                  color: STATUS_COLORS[hovered.status] ?? "#8b949e",
                  background: `${STATUS_COLORS[hovered.status] ?? "#8b949e"}22`,
                  fontWeight: 600,
                }}
              >
                {hovered.status}
              </span>
            )}
          </div>

          {/* summary */}
          {hovered.summary && hovered.summary !== hovered.name && (
            <div
              style={{
                fontSize: 13,
                color: "#c9d1d9",
                lineHeight: 1.5,
                maxHeight: 90,
                overflow: "auto",
                marginBottom: 8,
              }}
            >
              {hovered.summary}
            </div>
          )}

          {/* meeting sources */}
          {hovered.sources.length > 0 && (
            <div style={{ borderTop: "1px solid #21262d", paddingTop: 8 }}>
              <div
                style={{
                  fontSize: 11,
                  color: "#484f58",
                  marginBottom: 4,
                  textTransform: "uppercase",
                  letterSpacing: 1,
                }}
              >
                From meetings
              </div>
              {hovered.sources.map((src, i) => (
                <a
                  key={i}
                  href={src.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: "block",
                    fontSize: 12,
                    color: "#58a6ff",
                    textDecoration: "none",
                    marginBottom: 2,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  📝 {src.title}
                </a>
              ))}
            </div>
          )}

          {/* Notion link */}
          {hovered.notionUrl && (
            <a
              href={hovered.notionUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "block",
                fontSize: 11,
                color: "#484f58",
                textDecoration: "none",
                marginTop: 6,
              }}
            >
              Open in Notion →
            </a>
          )}

          {hovered.lastUpdated && (
            <div style={{ fontSize: 11, color: "#484f58", marginTop: 4 }}>
              Updated: {new Date(hovered.lastUpdated).toLocaleDateString()}
            </div>
          )}
        </div>
      )}

      {/* ---- Graph ---- */}
      <ForceGraph2D
        ref={fgRef}
        graphData={filteredData}
        nodeId="id"
        nodeCanvasObject={nodeCanvasObject}
        nodePointerAreaPaint={(node: any, color, ctx) => {
          ctx.beginPath();
          ctx.arc(node.x, node.y, 12, 0, 2 * Math.PI);
          ctx.fillStyle = color;
          ctx.fill();
        }}
        linkColor={linkColor}
        linkWidth={(link: any) => (link.type === "has_action" ? 0.5 : 1.5)}
        linkDirectionalArrowLength={(link: any) =>
          link.type === "has_action" ? 0 : 4
        }
        linkDirectionalArrowRelPos={0.85}
        linkCurvature={0.15}
        onNodeHover={(node: any) => setHovered(node ?? null)}
        onNodeClick={(node: any) => {
          if (node.notionUrl) window.open(node.notionUrl, "_blank");
        }}
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

/* ---- style constants ---- */
const centerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  height: "100vh",
  flexDirection: "column",
  gap: 12,
};
const btnStyle: React.CSSProperties = {
  background: "#21262d",
  color: "#e6edf3",
  border: "1px solid #30363d",
  borderRadius: 6,
  padding: "8px 16px",
  cursor: "pointer",
};
const spinnerStyle: React.CSSProperties = {
  width: 20,
  height: 20,
  border: "2px solid #30363d",
  borderTopColor: "#58a6ff",
  borderRadius: "50%",
  animation: "spin 1s linear infinite",
};
const headerStyle: React.CSSProperties = {
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
};
const liveBadge: React.CSSProperties = {
  fontSize: 11,
  color: "#3fb950",
  background: "rgba(63,185,80,0.15)",
  padding: "2px 8px",
  borderRadius: 10,
};
const legendStyle: React.CSSProperties = {
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
  pointerEvents: "auto",
};
const tooltipStyle: React.CSSProperties = {
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
  pointerEvents: "auto",
};
const tagBadge: React.CSSProperties = {
  color: "#8b949e",
  textTransform: "uppercase",
  letterSpacing: 1,
  background: "rgba(139,148,158,0.1)",
  padding: "2px 6px",
  borderRadius: 4,
};
