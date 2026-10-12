/**
 * 顶栏网关健康点：当前基址通不通、令牌过不过、RTT 多少，一眼可见。
 * 30s 轮询 + 切窗口即查；点一下进设置 → 网关页。失败不弹 toast（只变色），
 * 真正的错误由各处请求就近 loud 报错。
 */
import React from "react";
import { useQuery, useQueryClient, QueryClient } from "@tanstack/react-query";
import { getGatewayBase, verifyGatewayToken, type GatewayAuthState } from "@/lib/gateway-auth";
import { useWorkbenchStore } from "@/stores/useWorkbenchStore";
import { cn } from "@/lib/utils";

export const GATEWAY_HEALTH_STALE_MS = 10000;
export const GATEWAY_HEALTH_INTERVAL_MS = 30000;

/** 健康态 → 圆点样式（纯函数，可测）。 */
export function healthDotClass(state: GatewayAuthState | undefined, fetching: boolean): string {
  if (fetching || state === undefined) return "bg-muted-foreground animate-pulse";
  if (state === "ok") return "bg-success";
  if (state === "unauthorized") return "bg-warning";
  return "bg-destructive";
}

const fallbackClient = new QueryClient({ defaultOptions: { queries: { enabled: false } } });

export const GatewayDot: React.FC = () => {
  const openSettings = useWorkbenchStore((s) => s.openSettings);
  const base = getGatewayBase();
  let client: QueryClient | undefined;
  try {
    client = useQueryClient();
  } catch {
    client = fallbackClient;
  }
  const q = useQuery(
    {
      queryKey: ["universal", "gateway-health", base],
      queryFn: async () => {
        const t0 = Date.now();
        const st = await verifyGatewayToken();
        return { st, ms: Date.now() - t0 };
      },
      staleTime: GATEWAY_HEALTH_STALE_MS,
      refetchInterval: GATEWAY_HEALTH_INTERVAL_MS,
      refetchOnWindowFocus: true,
      retry: false,
    },
    client,
  );
  const st = q.data?.st;
  const label =
    st === undefined
      ? "网关检查中…"
      : st === "ok"
        ? `网关正常 · ${base || "本地"} · ${q.data?.ms ?? 0}ms`
        : st === "unauthorized"
          ? `网关通但令牌被拒 · ${base || "本地"}（点此去设置页重输）`
          : `网关不可达 · ${base || "本地"}（点此去设置页检查）`;
  return (
    <button
      type="button"
      onClick={() => openSettings("gateway")}
      className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
      title={label}
      aria-label={label}
    >
      <span className={cn("h-2 w-2 rounded-full shrink-0", healthDotClass(st, q.isFetching))} />
      <span className="font-mono text-[10px] hidden @lg:inline">网关</span>
    </button>
  );
};
