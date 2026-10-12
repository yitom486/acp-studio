import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "@/App";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ErrorToast } from "@/components/ErrorToast";
import { UpdateNotice } from "@/components/UpdateNotice";
import { SettingsModal } from "@/components/workbench/SettingsModal";
import { CommandPalette } from "@/components/workbench/CommandPalette";
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
        <UpdateNotice />
        <SettingsModal />
        <CommandPalette />
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
  if (mode !== "conversation" && mode !== "approval" && mode !== "stream") return;
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
  if (mode === "stream") simulateStream(useStudioStore);
  console.info("[dev] conversation fixture loaded");
}

/** `?fixture=stream`：把最后一条助手消息逐字“流”出来，用于检查跟随滚动 / 光环 / 淡入。 */
function simulateStream(store: { getState: () => any }) {
  const text =
    "README 的示例已经改好。接下来提交这两个文件的改动，然后跑一遍测试确认没有回归。\n\n" +
    "## 本轮改动\n\n" +
    "- `src/greet.ts`：空名字回退为 \"there\"，补上参数类型。\n" +
    "- `tests/greet.test.ts`：覆盖空字符串、纯空格和普通名字三种情况。\n" +
    "- `README.md`：用法示例的输出改成 `Hello, Ada!`。\n\n" +
    "测试结果：3 个用例全部通过，类型检查无报错。\n\n" +
    "## 后续建议\n\n" +
    "1. 给 `greet` 加一个可选的语言参数，方便以后做本地化。\n" +
    "2. 在 CI 里加上 `vitest --coverage`，把覆盖率门槛设在 80%。\n" +
    "3. README 里补一段“常见问题”，说明空名字的行为。\n\n" +
    "提交信息：`fix(greet): handle empty names`。如果还需要我顺便发一个补丁版本，告诉我即可。";
  const setText = (content: string, done: boolean) => {
    const st = store.getState();
    st.setMessages(
      st.messages.map((m: any) =>
        m.id === "fx-a2"
          ? { ...m, content, isStreaming: !done, completedAt: done ? Date.now() : undefined, toolCalls: (m.toolCalls || []).map((t: any) => ({ ...t, status: "completed" })) }
          : m,
      ),
    );
    if (done) st.setStreaming(false);
  };
  let i = 0;
  setText("", false);
  const timer = setInterval(() => {
    i = Math.min(text.length, i + 3);
    setText(text.slice(0, i), false);
    if (i >= text.length) {
      clearInterval(timer);
      setTimeout(() => setText(text, true), 600);
    }
  }, 60);
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
