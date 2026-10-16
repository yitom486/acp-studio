import React, { useState, useRef, useMemo } from "react";
import {
  Maximize2,
  Minimize2,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Copy,
  Check,
  Download,
  Layers,
  ArrowRightLeft,
  GitCommit,
  Grid,
  Calendar,
  Sparkles,
} from "lucide-react";

export type DiagramType =
  | "architecture"
  | "sequence"
  | "flowchart"
  | "quadrant"
  | "timeline";

export type AccentColor =
  | "emerald"
  | "blue"
  | "indigo"
  | "violet"
  | "amber"
  | "rose"
  | "cyan";

export interface EditorialDiagramCardProps {
  title: string;
  diagramType: DiagramType;
  description?: string;
  theme?: "light" | "dark" | "system";
  accent?: AccentColor;
  data: Record<string, any>;
}

// 1-Accent 聚焦配色方案字典
const ACCENT_MAP: Record<
  AccentColor,
  {
    border: string;
    bg: string;
    text: string;
    fill: string;
    stroke: string;
    dot: string;
  }
> = {
  emerald: {
    border: "border-emerald-500/60",
    bg: "bg-emerald-500/10",
    text: "text-emerald-500 dark:text-emerald-400",
    fill: "#10b981",
    stroke: "#10b981",
    dot: "bg-emerald-500",
  },
  blue: {
    border: "border-blue-500/60",
    bg: "bg-blue-500/10",
    text: "text-blue-500 dark:text-blue-400",
    fill: "#3b82f6",
    stroke: "#3b82f6",
    dot: "bg-blue-500",
  },
  indigo: {
    border: "border-indigo-500/60",
    bg: "bg-indigo-500/10",
    text: "text-indigo-500 dark:text-indigo-400",
    fill: "#6366f1",
    stroke: "#6366f1",
    dot: "bg-indigo-500",
  },
  violet: {
    border: "border-violet-500/60",
    bg: "bg-violet-500/10",
    text: "text-violet-500 dark:text-violet-400",
    fill: "#8b5cf6",
    stroke: "#8b5cf6",
    dot: "bg-violet-500",
  },
  amber: {
    border: "border-amber-500/60",
    bg: "bg-amber-500/10",
    text: "text-amber-500 dark:text-amber-400",
    fill: "#f59e0b",
    stroke: "#f59e0b",
    dot: "bg-amber-500",
  },
  rose: {
    border: "border-rose-500/60",
    bg: "bg-rose-500/10",
    text: "text-rose-500 dark:text-rose-400",
    fill: "#f43f5e",
    stroke: "#f43f5e",
    dot: "bg-rose-500",
  },
  cyan: {
    border: "border-cyan-500/60",
    bg: "bg-cyan-500/10",
    text: "text-cyan-500 dark:text-cyan-400",
    fill: "#06b6d4",
    stroke: "#06b6d4",
    dot: "bg-cyan-500",
  },
};

const DIAGRAM_TYPE_META: Record<
  DiagramType,
  { label: string; icon: React.FC<{ className?: string }> }
> = {
  architecture: { label: "系统架构分层", icon: Layers },
  sequence: { label: "交互时序图", icon: ArrowRightLeft },
  flowchart: { label: "流程与状态机", icon: GitCommit },
  quadrant: { label: "四象限决策矩阵", icon: Grid },
  timeline: { label: "演进里程碑", icon: Calendar },
};

export const EditorialDiagramCard: React.FC<EditorialDiagramCardProps> = ({
  title,
  diagramType,
  description,
  accent = "emerald",
  data,
}) => {
  const [zoom, setZoom] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [copied, setCopied] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const accentStyles = ACCENT_MAP[accent] || ACCENT_MAP.emerald;
  const meta = DIAGRAM_TYPE_META[diagramType] || DIAGRAM_TYPE_META.architecture;
  const Icon = meta.icon;

  const handleCopySvg = () => {
    if (!containerRef.current) return;
    const svgEl = containerRef.current.querySelector("svg");
    if (!svgEl) return;
    navigator.clipboard.writeText(svgEl.outerHTML).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleDownloadSvg = () => {
    if (!containerRef.current) return;
    const svgEl = containerRef.current.querySelector("svg");
    if (!svgEl) return;
    const blob = new Blob([svgEl.outerHTML], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.toLowerCase().replace(/\s+/g, "-")}-${diagramType}.svg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div
      className={`my-3.5 rounded-xl border border-border/70 bg-card/90 overflow-hidden shadow-sm transition-all duration-200 ${
        isFullscreen
          ? "fixed inset-4 z-50 flex flex-col bg-background/95 backdrop-blur-md shadow-2xl border-border"
          : ""
      }`}
    >
      {/* 顶部 Editorial Header */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-muted/30 border-b border-border/50 text-xs">
        <div className="flex items-center gap-2 min-w-0">
          <div className={`p-1 rounded-md ${accentStyles.bg}`}>
            <Icon className={`w-3.5 h-3.5 ${accentStyles.text}`} />
          </div>
          <span className="font-semibold text-foreground truncate">{title}</span>
          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono tracking-tight bg-secondary/80 text-muted-foreground border border-border/40">
            {meta.label}
          </span>
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground font-mono">
            <Sparkles className="w-2.5 h-2.5 text-muted-foreground/70" />
            editorial
          </span>
        </div>

        {/* 交互工具条 */}
        <div className="flex items-center gap-1 text-muted-foreground">
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(z + 0.15, 2.0))}
            className="p-1 rounded hover:text-foreground hover:bg-muted/80 transition-colors"
            title="放大"
            aria-label="放大"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(z - 0.15, 0.6))}
            className="p-1 rounded hover:text-foreground hover:bg-muted/80 transition-colors"
            title="缩小"
            aria-label="缩小"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          {zoom !== 1 && (
            <button
              type="button"
              onClick={() => setZoom(1)}
              className="p-1 rounded hover:text-foreground hover:bg-muted/80 transition-colors text-[10px] font-mono"
              title="重置缩放"
              aria-label="重置缩放"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}
          <div className="w-[1px] h-3 bg-border/60 mx-1" />
          <button
            type="button"
            onClick={handleCopySvg}
            className="p-1 rounded hover:text-foreground hover:bg-muted/80 transition-colors"
            title="复制 SVG 源码"
            aria-label="复制 SVG 源码"
          >
            {copied ? (
              <Check className="w-3.5 h-3.5 text-emerald-500" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
          </button>
          <button
            type="button"
            onClick={handleDownloadSvg}
            className="p-1 rounded hover:text-foreground hover:bg-muted/80 transition-colors"
            title="下载 SVG 矢量文件"
            aria-label="下载 SVG"
          >
            <Download className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="p-1 rounded hover:text-foreground hover:bg-muted/80 transition-colors"
            title={isFullscreen ? "退出全屏" : "全屏放大"}
            aria-label={isFullscreen ? "退出全屏" : "全屏放大"}
          >
            {isFullscreen ? (
              <Minimize2 className="w-3.5 h-3.5" />
            ) : (
              <Maximize2 className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
      </div>

      {description && (
        <div className="px-4 py-1.5 text-xs text-muted-foreground border-b border-border/30 bg-muted/10">
          {description}
        </div>
      )}

      {/* SVG 矢量图表画布区域 */}
      <div
        ref={containerRef}
        className={`relative overflow-auto p-4 flex items-center justify-center bg-card select-none ${
          isFullscreen ? "flex-1 min-h-[500px]" : "min-h-[280px]"
        }`}
      >
        <div
          style={{
            transform: `scale(${zoom})`,
            transformOrigin: "center center",
            transition: "transform 0.15s ease-out",
          }}
          className="w-full flex justify-center"
        >
          {diagramType === "architecture" && (
            <ArchitectureDiagramSvg data={data} accent={accent} />
          )}
          {diagramType === "sequence" && (
            <SequenceDiagramSvg data={data} accent={accent} />
          )}
          {diagramType === "flowchart" && (
            <FlowchartDiagramSvg data={data} accent={accent} />
          )}
          {diagramType === "quadrant" && (
            <QuadrantDiagramSvg data={data} accent={accent} />
          )}
          {diagramType === "timeline" && (
            <TimelineDiagramSvg data={data} accent={accent} />
          )}
        </div>
      </div>
    </div>
  );
};

// =============================================================================
// 1. Architecture Diagram (分层系统架构与容器拓扑)
// =============================================================================
function ArchitectureDiagramSvg({
  data,
  accent,
}: {
  data: Record<string, any>;
  accent: AccentColor;
}) {
  const accentStyles = ACCENT_MAP[accent] || ACCENT_MAP.emerald;
  const layers = Array.isArray(data.layers) ? data.layers : [];
  const connections = Array.isArray(data.connections) ? data.connections : [];

  const width = 640;
  const layerHeight = 84;
  const gap = 24;
  const topPad = 20;
  const totalHeight = Math.max(
    layers.length * (layerHeight + gap) + topPad + 40,
    280
  );

  return (
    <svg
      viewBox={`0 0 ${width} ${totalHeight}`}
      className="w-full max-w-[640px] h-auto font-sans"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <marker
          id={`arrow-${accent}`}
          viewBox="0 0 10 10"
          refX="6"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 1 L 8 5 L 0 9 z" fill={accentStyles.fill} />
        </marker>
        <marker
          id="arrow-neutral"
          viewBox="0 0 10 10"
          refX="6"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 1 L 8 5 L 0 9 z" fill="#888888" />
        </marker>
      </defs>

      {/* 渲染各层容器 */}
      {layers.map((layer: any, layerIdx: number) => {
        const y = topPad + layerIdx * (layerHeight + gap);
        const nodes = Array.isArray(layer.nodes) ? layer.nodes : [];
        const nodeWidth = nodes.length > 0 ? (width - 120) / nodes.length - 12 : 120;

        return (
          <g key={layer.id || layerIdx} transform={`translate(0, ${y})`}>
            {/* 分层容器底框 */}
            <rect
              x="20"
              y="0"
              width={width - 40}
              height={layerHeight}
              rx="8"
              fill="currentColor"
              className="text-muted/15"
              stroke="currentColor"
              strokeDasharray="4 4"
              strokeWidth="1"
              strokeOpacity="0.4"
            />
            {/* 层级名称 */}
            <text
              x="32"
              y="18"
              className="text-[11px] font-mono font-semibold uppercase tracking-wider fill-muted-foreground"
            >
              {layer.title || layer.name || `Layer ${layerIdx + 1}`}
            </text>

            {/* 容器内的节点卡片 */}
            {nodes.map((node: any, nodeIdx: number) => {
              const nx = 40 + nodeIdx * (nodeWidth + 12);
              const ny = 26;
              const isHighlighted = Boolean(node.highlighted || node.focus);

              return (
                <g key={node.id || nodeIdx} transform={`translate(${nx}, ${ny})`}>
                  <rect
                    x="0"
                    y="0"
                    width={nodeWidth}
                    height="46"
                    rx="6"
                    fill="currentColor"
                    className={
                      isHighlighted
                        ? `${accentStyles.bg} text-card`
                        : "text-card"
                    }
                    stroke={isHighlighted ? accentStyles.stroke : "currentColor"}
                    strokeWidth={isHighlighted ? 1.5 : 1}
                    strokeOpacity={isHighlighted ? 1 : 0.4}
                  />
                  <text
                    x="10"
                    y="20"
                    className="text-[12px] font-semibold fill-foreground"
                  >
                    {node.label || node.title}
                  </text>
                  <text
                    x="10"
                    y="36"
                    className="text-[10px] font-mono fill-muted-foreground"
                  >
                    {node.subtext || node.type || node.badge || ""}
                  </text>
                  {isHighlighted && (
                    <circle
                      cx={nodeWidth - 12}
                      cy="12"
                      r="3.5"
                      fill={accentStyles.fill}
                    />
                  )}
                </g>
              );
            })}
          </g>
        );
      })}

      {/* 层间连接线 */}
      {connections.map((conn: any, idx: number) => {
        const fromIdx = layers.findIndex(
          (l: any) =>
            l.id === conn.from ||
            (Array.isArray(l.nodes) && l.nodes.some((n: any) => n.id === conn.from))
        );
        const toIdx = layers.findIndex(
          (l: any) =>
            l.id === conn.to ||
            (Array.isArray(l.nodes) && l.nodes.some((n: any) => n.id === conn.to))
        );

        if (fromIdx >= 0 && toIdx >= 0 && fromIdx !== toIdx) {
          const sy = topPad + fromIdx * (layerHeight + gap) + layerHeight;
          const ey = topPad + toIdx * (layerHeight + gap);
          const cx = width / 2 + (idx % 3 - 1) * 60;

          return (
            <g key={idx}>
              <line
                x1={cx}
                y1={sy}
                x2={cx}
                y2={ey}
                stroke={conn.highlighted ? accentStyles.stroke : "#888888"}
                strokeWidth={conn.highlighted ? 1.5 : 1}
                strokeDasharray={conn.dashed ? "3 3" : undefined}
                markerEnd={
                  conn.highlighted
                    ? `url(#arrow-${accent})`
                    : "url(#arrow-neutral)"
                }
              />
              {conn.label && (
                <text
                  x={cx + 6}
                  y={(sy + ey) / 2}
                  className="text-[10px] font-mono fill-muted-foreground"
                >
                  {conn.label}
                </text>
              )}
            </g>
          );
        }
        return null;
      })}
    </svg>
  );
}

// =============================================================================
// 2. Sequence Diagram (交互时序图)
// =============================================================================
function SequenceDiagramSvg({
  data,
  accent,
}: {
  data: Record<string, any>;
  accent: AccentColor;
}) {
  const accentStyles = ACCENT_MAP[accent] || ACCENT_MAP.emerald;
  const messages: any[] = Array.isArray(data.messages)
    ? data.messages
    : Array.isArray(data.steps)
      ? data.steps
      : [];

  const participants: any[] = useMemo(() => {
    if (Array.isArray(data.participants) && data.participants.length > 0) {
      return data.participants;
    }
    const set = new Set<string>();
    for (const m of messages) {
      const src = m.from ?? m.source ?? m.fromParticipant;
      const tgt = m.to ?? m.target ?? m.toParticipant;
      if (src) set.add(String(src));
      if (tgt) set.add(String(tgt));
    }
    if (set.size > 0) {
      return Array.from(set).map((name) => ({ id: name, label: name }));
    }
    return [
      { id: "Client", label: "Client" },
      { id: "Server", label: "Server" },
    ];
  }, [data.participants, messages]);

  const width = 640;
  const pCount = Math.max(participants.length, 2);
  const colWidth = (width - 80) / pCount;
  const rowHeight = 44;
  const headerHeight = 46;
  const totalHeight = headerHeight + Math.max(messages.length, 1) * rowHeight + 40;

  const getColX = (idOrIndex: string | number) => {
    let idx = typeof idOrIndex === "number" ? idOrIndex : -1;
    if (idx === -1) {
      const str = String(idOrIndex || "").trim().toLowerCase();
      idx = participants.findIndex(
        (p: any) =>
          p.id === idOrIndex ||
          p.name === idOrIndex ||
          p.label === idOrIndex ||
          String(p.id || "").toLowerCase() === str ||
          String(p.label || "").toLowerCase() === str ||
          String(p.name || "").toLowerCase() === str
      );
    }
    if (idx === -1) idx = 0;
    return 40 + idx * colWidth + colWidth / 2;
  };

  return (
    <svg
      viewBox={`0 0 ${width} ${totalHeight}`}
      className="w-full max-w-[640px] h-auto font-sans"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <marker
          id={`seq-arrow-${accent}`}
          viewBox="0 0 10 10"
          refX="6"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 1 L 8 5 L 0 9 z" fill={accentStyles.fill} />
        </marker>
        <marker
          id="seq-arrow-default"
          viewBox="0 0 10 10"
          refX="6"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 1 L 8 5 L 0 9 z" fill="#888888" />
        </marker>
      </defs>

      {/* 参与者顶栏及垂直虚线生命线 */}
      {participants.map((p: any, idx: number) => {
        const x = getColX(idx);
        const boxWidth = Math.min(colWidth - 16, 120);

        return (
          <g key={p.id || idx}>
            {/* 垂直生命线 */}
            <line
              x1={x}
              y1={headerHeight}
              x2={x}
              y2={totalHeight - 20}
              stroke="currentColor"
              strokeDasharray="4 4"
              strokeWidth="1"
              strokeOpacity="0.25"
            />
            {/* 顶栏卡片 */}
            <rect
              x={x - boxWidth / 2}
              y="8"
              width={boxWidth}
              height="30"
              rx="6"
              fill="currentColor"
              className="text-card"
              stroke="currentColor"
              strokeWidth="1"
              strokeOpacity="0.4"
            />
            <text
              x={x}
              y="27"
              textAnchor="middle"
              className="text-[12px] font-semibold fill-foreground"
            >
              {p.label || p.name || `Actor ${idx + 1}`}
            </text>
          </g>
        );
      })}

      {/* 时序交互消息箭头 */}
      {messages.map((m: any, mIdx: number) => {
        const y = headerHeight + (mIdx + 1) * rowHeight - 8;
        const fromId = m.from ?? m.source ?? m.fromParticipant ?? 0;
        const toId = m.to ?? m.target ?? m.toParticipant ?? Math.min(1, participants.length - 1);
        const x1 = getColX(fromId);
        const x2 = getColX(toId);
        const isSelf = Math.abs(x1 - x2) < 4;
        const isReply = m.type === "reply" || m.dashed;
        const isHighlighted = Boolean(m.highlighted);

        return (
          <g key={mIdx}>
            {isSelf ? (
              <path
                d={`M ${x1} ${y - 6} C ${x1 + 40} ${y - 12}, ${x1 + 40} ${y + 12}, ${x1 + 4} ${y + 6}`}
                fill="none"
                stroke={isHighlighted ? accentStyles.stroke : "#888888"}
                strokeWidth={isHighlighted ? 1.5 : 1}
                markerEnd={
                  isHighlighted
                    ? `url(#seq-arrow-${accent})`
                    : "url(#seq-arrow-default)"
                }
              />
            ) : (
              <line
                x1={x1}
                y1={y}
                x2={x2}
                y2={y}
                stroke={isHighlighted ? accentStyles.stroke : "#888888"}
                strokeWidth={isHighlighted ? 1.5 : 1}
                strokeDasharray={isReply ? "3 3" : undefined}
                markerEnd={
                  isHighlighted
                    ? `url(#seq-arrow-${accent})`
                    : "url(#seq-arrow-default)"
                }
              />
            )}
            {/* 消息文字说明 */}
            <text
              x={(x1 + x2) / 2 + (isSelf ? 28 : 0)}
              y={y - 6}
              textAnchor="middle"
              className={`text-[11px] font-mono ${
                isHighlighted
                  ? `font-semibold ${accentStyles.text}`
                  : "fill-foreground"
              }`}
            >
              {m.label || m.text || m.name || m.title || `Step ${mIdx + 1}`}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// =============================================================================
// 3. Flowchart & State Machine (流程与状态机)
// =============================================================================
function FlowchartDiagramSvg({
  data,
  accent,
}: {
  data: Record<string, any>;
  accent: AccentColor;
}) {
  const accentStyles = ACCENT_MAP[accent] || ACCENT_MAP.emerald;
  const steps: any[] = Array.isArray(data.steps)
    ? data.steps
    : Array.isArray(data.nodes)
      ? data.nodes
      : [];
  const rawConns: any[] = Array.isArray(data.connections)
    ? data.connections
    : Array.isArray(data.edges)
      ? data.edges
      : [];

  const connections = useMemo(() => {
    if (rawConns.length > 0) return rawConns;
    if (steps.length > 1) {
      return steps.slice(0, -1).map((s, i) => ({
        from: s.id ?? i,
        to: steps[i + 1].id ?? i + 1,
      }));
    }
    return [];
  }, [rawConns, steps]);

  const width = 640;
  const cardWidth = 140;
  const cardHeight = 56;
  const cols = Math.min(Math.max(steps.length, 1), 3);
  const rows = Math.max(Math.ceil(steps.length / 3), 1);
  const totalHeight = Math.max(rows * 110 + 40, 240);

  const getStepCoord = (idx: number) => {
    const col = idx % 3;
    const row = Math.floor(idx / 3);
    const colGap = (width - 60 - cols * cardWidth) / (cols > 1 ? cols - 1 : 1);
    const x = 30 + col * (cardWidth + colGap);
    const y = 30 + row * 110;
    return { x, y };
  };

  return (
    <svg
      viewBox={`0 0 ${width} ${totalHeight}`}
      className="w-full max-w-[640px] h-auto font-sans"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <marker
          id={`flow-arrow-${accent}`}
          viewBox="0 0 10 10"
          refX="6"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 1 L 8 5 L 0 9 z" fill={accentStyles.fill} />
        </marker>
      </defs>

      {/* 渲染步骤连线 */}
      {connections.map((conn: any, idx: number) => {
        const fromId = conn.from ?? conn.source;
        const toId = conn.to ?? conn.target;
        const fromIdx = steps.findIndex((s: any, i: number) => s.id === fromId || i === fromId);
        const toIdx = steps.findIndex((s: any, i: number) => s.id === toId || i === toId);
        if (fromIdx >= 0 && toIdx >= 0) {
          const s1 = getStepCoord(fromIdx);
          const s2 = getStepCoord(toIdx);
          const x1 = s1.x + cardWidth / 2;
          const y1 = s1.y + cardHeight / 2;
          const x2 = s2.x + cardWidth / 2;
          const y2 = s2.y + cardHeight / 2;

          return (
            <line
              key={idx}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke="#888888"
              strokeWidth="1"
              markerEnd={`url(#flow-arrow-${accent})`}
            />
          );
        }
        return null;
      })}

      {/* 渲染各步骤卡片 */}
      {steps.map((step: any, idx: number) => {
        const { x, y } = getStepCoord(idx);
        const isCurrent = Boolean(step.isCurrent || step.active || step.highlighted);

        return (
          <g key={step.id || idx} transform={`translate(${x}, ${y})`}>
            <rect
              x="0"
              y="0"
              width={cardWidth}
              height={cardHeight}
              rx="8"
              fill="currentColor"
              className={
                isCurrent
                  ? `${accentStyles.bg} text-card`
                  : "text-card"
              }
              stroke={isCurrent ? accentStyles.stroke : "currentColor"}
              strokeWidth={isCurrent ? 1.5 : 1}
              strokeOpacity={isCurrent ? 1 : 0.4}
            />
            <text
              x="12"
              y="22"
              className="text-[12px] font-semibold fill-foreground"
            >
              {step.label || step.name || `Step ${idx + 1}`}
            </text>
            <text
              x="12"
              y="40"
              className="text-[10px] font-mono fill-muted-foreground truncate"
            >
              {step.description || step.status || ""}
            </text>
            {isCurrent && (
              <circle
                cx={cardWidth - 12}
                cy="12"
                r="3.5"
                fill={accentStyles.fill}
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}

// =============================================================================
// 4. Quadrant Matrix (四象限决策与技术选型矩阵)
// =============================================================================
function QuadrantDiagramSvg({
  data,
  accent,
}: {
  data: Record<string, any>;
  accent: AccentColor;
}) {
  const accentStyles = ACCENT_MAP[accent] || ACCENT_MAP.emerald;
  const xAxis = data.xAxis || { label: "Effort", low: "Low Effort", high: "High Effort" };
  const yAxis = data.yAxis || { label: "Impact", low: "Low Impact", high: "High Impact" };
  const items = Array.isArray(data.items) ? data.items : [];

  const width = 640;
  const height = 360;
  const midX = width / 2;
  const midY = height / 2;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full max-w-[640px] h-auto font-sans"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* 四象限底色分区 */}
      {/* Q1: 右上 (High X, High Y) */}
      <rect
        x={midX}
        y="20"
        width={midX - 20}
        height={midY - 20}
        className="fill-muted/10"
      />
      {/* Q2: 左上 (Low X, High Y) -> 重点推荐聚焦象限 */}
      <rect
        x="20"
        y="20"
        width={midX - 20}
        height={midY - 20}
        className={`${accentStyles.bg} opacity-20`}
      />
      {/* Q3: 左下 (Low X, Low Y) */}
      <rect
        x="20"
        y={midY}
        width={midX - 20}
        height={midY - 20}
        className="fill-muted/5"
      />
      {/* Q4: 右下 (High X, Low Y) */}
      <rect
        x={midX}
        y={midY}
        width={midX - 20}
        height={midY - 20}
        className="fill-muted/10"
      />

      {/* 十字坐标轴 */}
      <line
        x1="20"
        y1={midY}
        x2={width - 20}
        y2={midY}
        stroke="currentColor"
        strokeWidth="1.5"
        strokeOpacity="0.3"
      />
      <line
        x1={midX}
        y1="20"
        x2={midX}
        y2={height - 20}
        stroke="currentColor"
        strokeWidth="1.5"
        strokeOpacity="0.3"
      />

      {/* 轴标签 */}
      <text
        x="30"
        y={midY - 6}
        className="text-[10px] font-mono fill-muted-foreground uppercase"
      >
        ← {xAxis.low || "Low"}
      </text>
      <text
        x={width - 30}
        y={midY - 6}
        textAnchor="end"
        className="text-[10px] font-mono fill-muted-foreground uppercase"
      >
        {xAxis.high || "High"} →
      </text>
      <text
        x={midX + 6}
        y="32"
        className="text-[10px] font-mono fill-muted-foreground uppercase"
      >
        ↑ {yAxis.high || "High"}
      </text>
      <text
        x={midX + 6}
        y={height - 26}
        className="text-[10px] font-mono fill-muted-foreground uppercase"
      >
        ↓ {yAxis.low || "Low"}
      </text>

      {/* 象限内卡片元素 */}
      {items.map((item: any, idx: number) => {
        // quadrant 1: top-right, 2: top-left (quick wins), 3: bottom-left, 4: bottom-right
        const q = Number(item.quadrant || (item.x > 0.5 ? (item.y > 0.5 ? 1 : 4) : item.y > 0.5 ? 2 : 3));
        const baseX = q === 1 || q === 4 ? midX + 30 : 40;
        const baseY = q === 1 || q === 2 ? 40 : midY + 20;
        const isHighlighted = Boolean(item.highlighted || q === 2);

        const cardX = baseX + (idx % 2) * 120;
        const cardY = baseY + Math.floor(idx / 2) * 50;

        return (
          <g key={idx} transform={`translate(${cardX}, ${cardY})`}>
            <rect
              x="0"
              y="0"
              width="110"
              height="38"
              rx="6"
              fill="currentColor"
              className={
                isHighlighted
                  ? `${accentStyles.bg} text-card`
                  : "text-card"
              }
              stroke={isHighlighted ? accentStyles.stroke : "currentColor"}
              strokeWidth={isHighlighted ? 1.5 : 1}
              strokeOpacity={isHighlighted ? 1 : 0.4}
            />
            <text
              x="8"
              y="18"
              className="text-[11px] font-semibold fill-foreground"
            >
              {item.label}
            </text>
            <text
              x="8"
              y="30"
              className="text-[9px] font-mono fill-muted-foreground"
            >
              {item.subtext || (isHighlighted ? "推荐重点" : "")}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// =============================================================================
// 5. Timeline & Milestones (演进里程碑)
// =============================================================================
function TimelineDiagramSvg({
  data,
  accent,
}: {
  data: Record<string, any>;
  accent: AccentColor;
}) {
  const accentStyles = ACCENT_MAP[accent] || ACCENT_MAP.emerald;
  const milestones = Array.isArray(data.milestones) ? data.milestones : [];

  const width = 640;
  const count = Math.max(milestones.length, 2);
  const stepWidth = (width - 80) / count;
  const height = 240;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full max-w-[640px] h-auto font-sans"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* 水平时间线轴 */}
      <line
        x1="40"
        y1="90"
        x2={width - 40}
        y2="90"
        stroke="currentColor"
        strokeWidth="2"
        strokeOpacity="0.25"
      />

      {milestones.map((m: any, idx: number) => {
        const x = 40 + idx * stepWidth + stepWidth / 2;
        const isCompleted = m.status === "completed" || m.status === "done";
        const isCurrent = m.status === "in_progress" || m.status === "current" || m.highlighted;

        return (
          <g key={idx}>
            {/* 节点圆点 */}
            <circle
              cx={x}
              cy="90"
              r={isCurrent ? "7" : "5"}
              fill={isCurrent ? accentStyles.fill : isCompleted ? "#888888" : "currentColor"}
              className={!isCurrent && !isCompleted ? "text-muted" : ""}
              stroke={isCurrent ? "currentColor" : undefined}
              strokeWidth={isCurrent ? 2 : 0}
            />

            {/* 上方阶段 / 日期 */}
            <text
              x={x}
              y="70"
              textAnchor="middle"
              className={`text-[10px] font-mono ${
                isCurrent ? `font-semibold ${accentStyles.text}` : "fill-muted-foreground"
              }`}
            >
              {m.date || m.phase || `P${idx + 1}`}
            </text>

            {/* 下方里程碑标题与描述 */}
            <rect
              x={x - stepWidth / 2 + 8}
              y="112"
              width={stepWidth - 16}
              height="80"
              rx="6"
              fill="currentColor"
              className={
                isCurrent
                  ? `${accentStyles.bg} text-card`
                  : "text-card"
              }
              stroke={isCurrent ? accentStyles.stroke : "currentColor"}
              strokeWidth={isCurrent ? 1.5 : 1}
              strokeOpacity={isCurrent ? 1 : 0.3}
            />
            <text
              x={x}
              y="132"
              textAnchor="middle"
              className="text-[12px] font-semibold fill-foreground"
            >
              {m.title}
            </text>
            <text
              x={x}
              y="150"
              textAnchor="middle"
              className="text-[10px] font-mono fill-muted-foreground"
            >
              {m.description || m.status || ""}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
