"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
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
  sources: { title: string; url: string }[];
  notionUrl: string;
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

function getId(v: string | GraphNode): string {
  return typeof v === "string" ? v : v.id;
}

export default function Home() {
  const [data, setData] = useState<GraphData | null>(null);
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const prevFpRef = useRef("");
  const fgRef = useRef<any>(null);
  const forceConfigured = useRef(false);

  /* ---- data fetching ---- */
  const fetchGraph = useCallback(async () => {
    try {
      const res = await fetch("/api/graph");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: GraphData = await res.json();

      const fp = json.nodes
        .map((n) => n.id + (n.status ?? ""))
        .sort()
        .join(",");
      if (fp === prevFpRef.current) return;
      prevFpRef.current = fp;

      setData(json);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    fetchGraph();
    const id = setInterval(fetchGraph, 5_000);
    return () => clearInterval(id);
  }, [fetchGraph]);

  /* ---- configure d3 forces once ---- */
  useEffect(() => {
    if (fgRef.current && data && !forceConfigured.current) {
      forceConfigured.current = true;
      const fg = fgRef.current;
      fg.d3Force("charge")?.strength(-1800);
      fg.d3Force("link")?.distance(250);
      fg.d3Force("center")?.strength(0.02);
    }
  }, [data]);

  /* ---- filter + sort: actions first so projects render on top ---- */
  const filteredData = useMemo(() => {
    if (!data) return null;
    const hidden = showDone
      ? new Set<string>()
      : new Set(
          data.nodes
            .filter((n) => n.group === "action" && n.status === "Done")
            .map((n) => n.id),
        );
    const nodes = data.nodes
      .filter((n) => !hidden.has(n.id))
      .sort((a, b) => {
        if (a.group === "project" && b.group !== "project") return 1;
        if (a.group !== "project" && b.group === "project") return -1;
        return 0;
      });
    const links = data.links.filter(
      (l) =>
        !hidden.has(getId(l.source)) && !hidden.has(getId(l.target)),
    );
    return { ...data, nodes, links };
  }, [data, showDone]);

  /* ---- stable callbacks (no state in deps) ---- */
  const handleNodeColor = useCallback(
    (node: any) =>
      node.group === "action"
        ? (STATUS_COLORS[node.status ?? "Not started"] ?? "#8b949e")
        : (TYPE_COLORS[node.type] ?? "#d2a8ff"),
    [],
  );

  const handleNodeVal = useCallback(
    (node: any) => (node.group === "project" ? 20 : 6),
    [],
  );

  const handleNodeCanvasObject = useCallback(
    (node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
      if (node.x == null || node.y == null) return;

      const isAction = node.group === "action";
      const isDone = node.status === "Done";
      const label = node.name ?? "?";

      const color = isAction
        ? (STATUS_COLORS[node.status ?? "Not started"] ?? "#8b949e")
        : (TYPE_COLORS[node.type] ?? "#d2a8ff");

      const fontSize = isAction
        ? Math.max(9 / globalScale, 2)
        : Math.max(14 / globalScale, 3.5);

      ctx.save();
      ctx.globalAlpha = isDone ? 0.3 : 1;
      ctx.font = `${isAction ? "" : "bold "}${fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;

      const words = label.split(/\s+/);
      const maxTextW = (isAction ? 70 : 110) / globalScale;
      const lines: string[] = [];
      let cur = "";
      for (const w of words) {
        const test = cur ? cur + " " + w : w;
        if (ctx.measureText(test).width > maxTextW && cur) {
          lines.push(cur);
          cur = w;
        } else {
          cur = test;
        }
      }
      if (cur) lines.push(cur);
      const maxLines = isAction ? 2 : 3;
      const show = lines.slice(0, maxLines);
      if (lines.length > maxLines) {
        show[maxLines - 1] = show[maxLines - 1] + "…";
      }

      const lineH = fontSize * 1.3;
      const textBlockH = show.length * lineH;
      let widest = 0;
      for (const ln of show) {
        const w = ctx.measureText(ln).width;
        if (w > widest) widest = w;
      }

      const pad = (isAction ? 8 : 16) / globalScale;
      const contentW = widest + pad * 2;
      const contentH = textBlockH + pad * 2;
      const radius = Math.max(contentW, contentH) / 2 + pad * 0.3;

      if (!isAction && !isDone) {
        ctx.shadowColor = color;
        ctx.shadowBlur = 15 / globalScale;
      }

      ctx.beginPath();
      ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI);
      ctx.fillStyle = isAction
        ? `${color}${isDone ? "22" : "33"}`
        : `${color}${isDone ? "33" : "88"}`;
      ctx.fill();

      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;

      ctx.strokeStyle = isAction ? `${color}88` : color;
      ctx.lineWidth = (isAction ? 1 : 2.5) / globalScale;
      ctx.stroke();

      if (isDone) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI);
        ctx.strokeStyle = "#3fb950";
        ctx.lineWidth = 2.5 / globalScale;
        ctx.stroke();
      }

      ctx.fillStyle = isDone
        ? "rgba(255,255,255,0.4)"
        : isAction
          ? "rgba(255,255,255,0.8)"
          : "#ffffff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const startY = node.y - (textBlockH - lineH) / 2;
      for (let i = 0; i < show.length; i++) {
        ctx.fillText(show[i], node.x, startY + i * lineH);
      }

      ctx.restore();

      node.__radius = radius * globalScale;
    },
    [],
  );

  const handleNodePointerArea = useCallback(
    (node: any, color: string, ctx: CanvasRenderingContext2D, globalScale: number) => {
      if (node.x == null || node.y == null) return;
      const r = (node.__radius ?? 18) / globalScale;
      ctx.beginPath();
      ctx.arc(node.x, node.y, Math.max(r, 8), 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();
    },
    [],
  );

  const handleLinkColor = useCallback(
    (link: any) =>
      link.type === "has_action"
        ? "rgba(139,148,158,0.3)"
        : "rgba(88,166,255,0.5)",
    [],
  );

  const handleLinkWidth = useCallback(
    (link: any) => (link.type === "has_action" ? 0.5 : 1.5),
    [],
  );

  const handleArrowLen = useCallback(
    (link: any) => (link.type === "has_action" ? 0 : 4),
    [],
  );

  const handleNodeClick = useCallback((node: any) => {
    setSelected((prev) => (prev?.id === node.id ? null : node));
  }, []);

  const handleDragEnd = useCallback((node: any) => {
    node.fx = node.x;
    node.fy = node.y;
  }, []);

  const handleBgClick = useCallback(() => setSelected(null), []);

  /* ---- loading / error states ---- */
  if (error && !data) {
    return (
      <div style={centerStyle}>
        <p style={{ color: "#f85149", fontSize: 16 }}>
          Failed to load: {error}
        </p>
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

  /* ---- stats ---- */
  const allNodes = data!.nodes;
  const projectCount = allNodes.filter((n) => n.group === "project").length;
  const actionNodes = allNodes.filter((n) => n.group === "action");
  const inProg = actionNodes.filter((n) => n.status === "In progress").length;
  const done = actionNodes.filter((n) => n.status === "Done").length;
  const pending = actionNodes.filter((n) => n.status === "Not started").length;

  return (
    <div style={{ position: "relative", width: "100vw", height: "100vh" }}>
      {/* Header */}
      <div style={headerStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 18 }}>🧬</span>
          <span style={{ fontSize: 14, fontWeight: 600, color: "#e6edf3" }}>
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
        </div>
      </div>

      {/* Legend + toggle */}
      <div style={legendStyle}>
        {[
          { l: "project", c: "#d2a8ff", s: "circle" },
          { l: "pending", c: "#8b949e", s: "square" },
          { l: "in progress", c: "#d29922", s: "square" },
          { l: "done", c: "#3fb950", s: "square" },
        ].map((i) => (
          <div
            key={i.l}
            style={{ display: "flex", alignItems: "center", gap: 4 }}
          >
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: i.s === "circle" ? "50%" : 1,
                background: i.c,
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

      {/* Detail panel */}
      {selected && (
        <div style={tooltipStyle}>
          <button
            onClick={() => setSelected(null)}
            style={{
              position: "absolute",
              top: 8,
              right: 10,
              background: "none",
              border: "none",
              color: "#8b949e",
              cursor: "pointer",
              fontSize: 16,
            }}
          >
            ✕
          </button>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 8,
              paddingRight: 24,
            }}
          >
            <div
              style={{
                width: 10,
                height: 10,
                flexShrink: 0,
                borderRadius:
                  selected.group === "action" ? 2 : "50%",
                background:
                  selected.group === "action"
                    ? (STATUS_COLORS[selected.status ?? "Not started"] ??
                        "#8b949e")
                    : (TYPE_COLORS[selected.type] ?? "#d2a8ff"),
              }}
            />
            <span style={{ fontSize: 14, fontWeight: 600, color: "#e6edf3" }}>
              {selected.name}
            </span>
          </div>

          {selected.status && (
            <span
              style={{
                display: "inline-block",
                fontSize: 11,
                color:
                  STATUS_COLORS[selected.status] ?? "#8b949e",
                background: `${STATUS_COLORS[selected.status] ?? "#8b949e"}22`,
                padding: "2px 8px",
                borderRadius: 4,
                marginBottom: 8,
              }}
            >
              {selected.status}
            </span>
          )}

          {selected.summary && selected.summary !== selected.name && (
            <div
              style={{
                fontSize: 13,
                color: "#c9d1d9",
                lineHeight: 1.5,
                marginBottom: 10,
              }}
            >
              {selected.summary}
            </div>
          )}

          {selected.sources?.length > 0 && (
            <div
              style={{
                borderTop: "1px solid #21262d",
                paddingTop: 8,
                marginBottom: 8,
              }}
            >
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
              {selected.sources.map((src, i) => (
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
                    marginBottom: 3,
                  }}
                >
                  📝 {src.title}
                </a>
              ))}
            </div>
          )}

          {selected.notionUrl && (
            <a
              href={selected.notionUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "block",
                textAlign: "center",
                fontSize: 12,
                fontWeight: 600,
                color: "#fff",
                background: "#2f81f7",
                borderRadius: 6,
                padding: "8px 0",
                textDecoration: "none",
                marginTop: 8,
              }}
            >
              Open in Notion ↗
            </a>
          )}
        </div>
      )}

      {/* Graph */}
      <ForceGraph2D
        ref={fgRef}
        graphData={filteredData}
        nodeId="id"
        nodeCanvasObject={handleNodeCanvasObject}
        nodePointerAreaPaint={handleNodePointerArea}
        linkColor={handleLinkColor}
        linkWidth={handleLinkWidth}
        linkDirectionalArrowLength={handleArrowLen}
        linkDirectionalArrowRelPos={0.85}
        onNodeClick={handleNodeClick}
        onNodeDragEnd={handleDragEnd}
        onBackgroundClick={handleBgClick}
        backgroundColor="#0d1117"
        width={typeof window !== "undefined" ? window.innerWidth : 800}
        height={typeof window !== "undefined" ? window.innerHeight : 600}
        cooldownTicks={100}
        d3AlphaDecay={0.03}
        d3VelocityDecay={0.3}
        nodeRelSize={1}
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
  background: "#0d1117",
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
  maxHeight: "70vh",
  overflowY: "auto",
  background: "rgba(22,27,34,0.95)",
  border: "1px solid #30363d",
  borderRadius: 8,
  padding: 16,
  backdropFilter: "blur(8px)",
  pointerEvents: "auto",
};
