import React, { useId, useMemo, useState } from "react";
import {
  Check,
  Code2,
  Copy,
  Eye,
  Maximize2,
  Minimize2,
  Play,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface ReactArtifactCardProps {
  code: string;
  template?: "react" | "html";
  title?: string;
  description?: string;
  defaultTab?: "preview" | "code";
  className?: string;
}

/**
 * Builds the sandboxed HTML payload for execution in an isolated iframe.
 */
function buildSandboxSrcDoc(code: string, template: "react" | "html"): string {
  if (template === "html") {
    return `<!DOCTYPE html>
<html lang="zh-CN" class="dark">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: { extend: {} }
    };
  </script>
  <style>
    body {
      background-color: #0b0f17;
      color: #e2e8f0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      margin: 0;
      padding: 1rem;
    }
  </style>
</head>
<body>
  ${code}
</body>
</html>`;
  }

  // React 18 template with Babel standalone & Tailwind
  // We sanitize and extract code component or default export
  const escapedCode = JSON.stringify(code);

  return `<!DOCTYPE html>
<html lang="zh-CN" class="dark">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          colors: {
            border: '#1e293b',
            background: '#0b0f17',
            foreground: '#f8fafc',
            primary: '#38bdf8',
            secondary: '#1e293b',
            muted: '#334155',
          }
        }
      }
    };
  </script>
  <style>
    html, body {
      background-color: #0b0f17;
      color: #f8fafc;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      margin: 0;
      padding: 0;
      min-height: 100vh;
      overflow-x: hidden;
    }
    #error-container {
      display: none;
      margin: 1rem;
      padding: 1rem;
      background: rgba(239, 68, 68, 0.15);
      border: 1px solid rgba(239, 68, 68, 0.4);
      border-radius: 0.5rem;
      color: #f87171;
      font-family: monospace;
      font-size: 12px;
      white-space: pre-wrap;
    }
  </style>
  <script>
    window.__cdnErrors = [];
    window.onerror = function(msg, url, line, col, err) {
      const errBox = document.getElementById("error-container");
      if (errBox) {
        errBox.style.display = "block";
        errBox.textContent = "运行时错误: " + msg + (line ? " (行 " + line + ")" : "");
      }
      return false;
    };
    function handleCdnError(tag) {
      window.__cdnErrors.push(tag.src);
    }
  </script>
  <!-- Load React 18 & Babel standalone -->
  <script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js" onerror="handleCdnError(this)"></script>
  <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js" onerror="handleCdnError(this)"></script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js" onerror="handleCdnError(this)"></script>
</head>
<body class="p-4 flex flex-col justify-center items-center">
  <div id="error-container"></div>
  <div id="root" class="w-full"></div>

  <script>
    try {
      if (window.__cdnErrors && window.__cdnErrors.length > 0) {
        throw new Error("无法加载沙箱运行时（" + window.__cdnErrors.join(", ") + "）。若处于离线环境，沙箱预览需要网络连接。");
      }
      if (typeof Babel === "undefined" || typeof React === "undefined") {
        throw new Error("Babel 或 React 运行时未就绪。请检查网络连接。");
      }

      const rawCode = ${escapedCode};
      
      // Transform TypeScript / JSX using Babel
      let transformed = "";
      try {
        transformed = Babel.transform(rawCode, {
          presets: [
            ['react', { runtime: 'classic' }],
            'typescript'
          ],
          filename: 'Component.tsx'
        }).code;
      } catch (compileErr) {
        throw new Error("编译失败: " + compileErr.message);
      }

      // Prepare scope
      const { useState, useEffect, useMemo, useCallback, useRef, useReducer } = React;
      
      // Execute the transformed code
      let ComponentToRender = null;
      
      const exports = {};
      const module = { exports };
      
      const runFn = new Function(
        "React",
        "useState",
        "useEffect",
        "useMemo",
        "useCallback",
        "useRef",
        "useReducer",
        "module",
        "exports",
        transformed + "\\n; return (typeof App !== 'undefined' ? App : (typeof Component !== 'undefined' ? Component : (exports.default || module.exports.default || exports || module.exports)));"
      );

      ComponentToRender = runFn(
        React,
        useState,
        useEffect,
        useMemo,
        useCallback,
        useRef,
        useReducer,
        module,
        exports
      );

      if (!ComponentToRender || (typeof ComponentToRender !== 'function' && typeof ComponentToRender !== 'object')) {
        throw new Error("未在代码中找到可渲染的 React 组件 (例如 function App() 或 export default)。");
      }

      const root = ReactDOM.createRoot(document.getElementById('root'));
      root.render(React.createElement(ComponentToRender));
    } catch (e) {
      const errBox = document.getElementById("error-container");
      if (errBox) {
        errBox.style.display = "block";
        errBox.textContent = e.message;
      }
    }
  </script>
</body>
</html>`;
}

export const ReactArtifactCard: React.FC<ReactArtifactCardProps> = ({
  code,
  template = "react",
  title = "交互原型预览",
  description,
  defaultTab = "preview",
  className,
}) => {
  const [tab, setTab] = useState<"preview" | "code">(defaultTab);
  const [copied, setCopied] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const frameId = useId();

  const srcDoc = useMemo(
    () => buildSandboxSrcDoc(code, template),
    [code, template]
  );

  const handleCopy = () => {
    navigator.clipboard.writeText(code).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleRefresh = () => {
    setRefreshKey((k) => k + 1);
  };

  const containerContent = (
    <div
      className={cn(
        "rounded-xl border border-border bg-card/95 text-card-foreground shadow-md overflow-hidden flex flex-col transition-all",
        fullscreen
          ? "fixed inset-4 sm:inset-10 z-50 bg-background/95 backdrop-blur-md shadow-2xl flex flex-col border-border/80"
          : "my-3 w-full",
        className
      )}
    >
      {/* Header bar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/40 text-xs">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-5 h-5 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0">
            {template === "react" ? (
              <Sparkles className="w-3.5 h-3.5" />
            ) : (
              <Play className="w-3.5 h-3.5" />
            )}
          </div>
          <span className="font-semibold text-foreground truncate">{title}</span>
          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-muted text-muted-foreground uppercase">
            {template}
          </span>
          {description && (
            <span className="text-muted-foreground/80 truncate hidden sm:inline text-[11px]">
              · {description}
            </span>
          )}
        </div>

        {/* Tab switcher & Actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="flex items-center rounded-lg bg-background p-0.5 border border-border text-[11px]">
            <button
              type="button"
              onClick={() => setTab("preview")}
              className={cn(
                "flex items-center gap-1 px-2 py-0.5 rounded-md transition-colors font-medium",
                tab === "preview"
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Eye className="w-3 h-3" />
              <span>预览</span>
            </button>
            <button
              type="button"
              onClick={() => setTab("code")}
              className={cn(
                "flex items-center gap-1 px-2 py-0.5 rounded-md transition-colors font-medium",
                tab === "code"
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Code2 className="w-3 h-3" />
              <span>代码</span>
            </button>
          </div>

          {tab === "preview" && (
            <button
              type="button"
              onClick={handleRefresh}
              className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title="重新加载组件"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}

          <button
            type="button"
            onClick={handleCopy}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title="复制代码"
          >
            {copied ? (
              <Check className="w-3.5 h-3.5 text-success" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
          </button>

          <button
            type="button"
            onClick={() => setFullscreen((f) => !f)}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title={fullscreen ? "退出全屏" : "全屏放大"}
          >
            {fullscreen ? (
              <Minimize2 className="w-3.5 h-3.5" />
            ) : (
              <Maximize2 className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
      </div>

      {/* Main Body */}
      <div className={cn("relative flex-1 bg-background/50", fullscreen ? "h-full" : "h-[360px]")}>
        {tab === "preview" ? (
          <iframe
            key={refreshKey}
            id={frameId}
            title={title}
            srcDoc={srcDoc}
            sandbox="allow-scripts"
            className="w-full h-full border-0 bg-[#0b0f17]"
          />
        ) : (
          <pre className="w-full h-full overflow-auto p-3 text-xs font-mono text-foreground/90 bg-muted/20 leading-relaxed whitespace-pre select-text">
            {code}
          </pre>
        )}
      </div>
    </div>
  );

  if (fullscreen) {
    return (
      <>
        {/* Backdrop for fullscreen mode */}
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-xs"
          onClick={() => setFullscreen(false)}
        />
        {containerContent}
      </>
    );
  }

  return containerContent;
};
