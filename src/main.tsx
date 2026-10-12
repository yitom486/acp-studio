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
