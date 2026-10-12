import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "@/App";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ErrorToast } from "@/components/ErrorToast";
import { GatewayTokenGate } from "@/components/GatewayTokenGate";
import { installGlobalErrorCapture, reportError } from "@/lib/error-bus";
import { bootstrapGatewayToken, verifyGatewayToken } from "@/lib/gateway-auth";
import "@/index.css";

installGlobalErrorCapture();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

const root = ReactDOM.createRoot(document.getElementById("root")!);

function renderApp() {
  if (import.meta.env.DEV) void maybeSeedDevFixture();
  root.render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
        <ErrorToast />
      </QueryClientProvider>
    </React.StrictMode>
  );
}

/**
 * 开发专用：`?fixture=conversation`（或 `?fixture=approval`，额外带一条顶部
 * 全局授权卡）时用假数据填充对话界面，方便在没有装
 * 任何智能体 CLI 的机器上检查消息 / 工具卡 / 计划 / 授权 / 用量的样式。
 * 整个分支包在 import.meta.env.DEV 里，生产构建会被静态剔除。
 */
async function maybeSeedDevFixture() {
  if (!import.meta.env.DEV) return;
  const mode = new URLSearchParams(window.location.search).get("fixture");
  if (mode !== "conversation" && mode !== "approval") return;
  const [{ buildConversationFixture }, { useStudioStore }] = await Promise.all([
    import("@/dev/conversation-fixture"),
    import("@/stores/useStudioStore"),
  ]);
  const fx = buildConversationFixture({ globalPermission: mode === "approval" });
  const st = useStudioStore.getState();
  st.setSessionId(fx.sessionId);
  st.setMessages(fx.messages);
  st.setUsage(fx.usage);
  st.setStreaming(true);
  for (const p of fx.pendingPerms) st.addPermission(p);
  console.info("[dev] conversation fixture loaded");
}

function renderGate(reason: "missing" | "rejected" | "error", detail?: string) {
  root.render(
    <React.StrictMode>
      <GatewayTokenGate reason={reason} detail={detail} onAuthorized={renderApp} />
      <ErrorToast />
    </React.StrictMode>
  );
}

/**
 * 启动顺序：先拿网关令牌（Electron preload / 地址栏 ?token= / localStorage），
 * 校验通过才渲染应用；没有或被拒 → 令牌页。网关不可达时照常进应用，
 * 由各处请求就近报错（与原有行为一致）。
 */
async function boot() {
  let token: string | null;
  try {
    token = await bootstrapGatewayToken();
  } catch (err) {
    reportError("GatewayAuth", err);
    renderGate("error", `读取网关令牌失败：${(err as Error)?.message || err}`);
    return;
  }
  if (!token) {
    renderGate("missing");
    return;
  }
  const state = await verifyGatewayToken();
  if (state === "unauthorized") {
    renderGate("rejected");
    return;
  }
  renderApp();
}

void boot();
