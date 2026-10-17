import { execFileSync } from "node:child_process";
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import type { AcpAgentQuota, AcpQuotaLimitWindow } from "@yitom/acp-client";

export function resolveAntigravityAccount(): { email?: string; name?: string } {
  const home = process.env.USERPROFILE || process.env.HOME || os.homedir() || "";
  const candidates = [
    process.env.APPDATA ? path.join(process.env.APPDATA, "Antigravity", "app_storage.json") : null,
    path.join(home, ".config", "Antigravity", "app_storage.json"),
    path.join(home, "Library", "Application Support", "Antigravity", "app_storage.json"),
  ].filter(Boolean) as string[];

  for (const file of candidates) {
    try {
      if (fs.existsSync(file)) {
        const raw = fs.readFileSync(file, "utf8");
        const json = JSON.parse(raw);
        const username = json["jetski.onboarding.lastLoginUsername"];
        if (username && typeof username === "string" && username.trim()) {
          const u = username.trim();
          return { email: u, name: u.includes("@") ? u.split("@")[0] : u };
        }
      }
    } catch {}
  }
  return {};
}

function formatReset(isoStr?: string, fallbackDesc?: string): string | undefined {
  if (fallbackDesc && fallbackDesc.includes("it will fully refresh in ")) {
    const m = fallbackDesc.match(/it will fully refresh in (.+?)\.?$/);
    if (m?.[1]) return `Resets in ${m[1].trim()}`;
  }
  if (!isoStr) return undefined;
  const diffMs = new Date(isoStr).getTime() - Date.now();
  if (diffMs <= 0) return "已重置";
  const totalMins = Math.floor(diffMs / 60000);
  const hours = Math.floor(totalMins / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `Resets in ${days}d ${hours % 24}h`;
  return `Resets in ${hours}h ${totalMins % 60}m`;
}

function toWindow(b: any, groupName: string, label: string, durMins: number): AcpQuotaLimitWindow | undefined {
  if (!b) return undefined;
  const frac = typeof b.remainingFraction === "number" ? b.remainingFraction : 1;
  const percentLeft = Math.max(0, Math.min(100, Math.round(frac * 100)));
  const usedPercent = 100 - percentLeft;
  return {
    label,
    group: groupName,
    percentLeft,
    usedPercent,
    windowDurationMins: durMins,
    resetsAt: formatReset(b.resetTime, b.description),
  };
}

/**
 * 实时从本地运行中的 Antigravity Language Server 探询真实配额
 */
export async function probeLiveAgyQuota(runtimeId = "antigravity-stdio"): Promise<AcpAgentQuota | null> {
  const acc = resolveAntigravityAccount();

  if (process.platform === "win32") {
    try {
      const psScript = `
        $procs = Get-CimInstance Win32_Process | Where-Object { $_.Name -like "*agy*" -or $_.Name -like "*language_server*" }
        foreach ($p in $procs) {
          $cmd = $p.CommandLine
          if (!$cmd) { continue }
          $csrf = $null
          if ($cmd -match '--csrf_token[=\\s]+([a-f0-9\\-]+)') {
            $csrf = $matches[1]
          }
          if (!$csrf) { continue }

          $ports = @()
          if ($cmd -match '--hub-port[=\\s]+(\\d+)') {
            $ports += [int]$matches[1]
          }

          if ($ports.Count -eq 0) {
            $conns = Get-NetTCPConnection -OwningProcess $p.ProcessId -State Listen -ErrorAction SilentlyContinue
            foreach ($c in $conns) {
              $ports += $c.LocalPort
            }
          }

          foreach ($port in $ports) {
            try {
              $body = Invoke-RestMethod -Uri "http://127.0.0.1:$port/exa.language_server_pb.LanguageServerService/RetrieveUserQuotaSummary" -Method Post -Headers @{ "Content-Type" = "application/json"; "x-codeium-csrf-token" = $csrf } -Body "{}" -TimeoutSec 2
              if ($body.response.groups) {
                return @{ ok = $true; port = $port; csrf = $csrf; data = $body } | ConvertTo-Json -Depth 6 -Compress
              }
            } catch {}
          }
        }
        return "{}"
      `;
      const out = execFileSync("powershell", ["-NoProfile", "-Command", psScript], {
        encoding: "utf8",
        timeout: 5000,
        windowsHide: true,
      }).trim();

      if (out && out !== "{}") {
        const parsed = JSON.parse(out);
        if (parsed.ok && parsed.data?.response?.groups) {
          const groups = parsed.data.response.groups as Array<{
            displayName: string;
            description?: string;
            buckets?: Array<{
              bucketId?: string;
              displayName: string;
              description?: string;
              window?: string;
              remainingFraction?: number;
              resetTime?: string;
            }>;
          }>;

          const geminiGroup = groups.find((g) => {
            const d = g.displayName?.toLowerCase() || "";
            return d.includes("gemini") && !d.includes("argon");
          });
          const thirdPartyGroup = groups.find((g) => {
            const d = g.displayName?.toLowerCase() || "";
            return d.includes("claude") || d.includes("gpt") || d.includes("3p");
          });
          const argonGroup = groups.find((g) => {
            const d = g.displayName?.toLowerCase() || "";
            return d.includes("argon");
          });

          const gemini5h = geminiGroup?.buckets?.find(
            (b) => b.displayName?.toLowerCase().includes("five hour") || b.bucketId?.includes("5h") || b.window === "5h",
          );
          const geminiWeekly = geminiGroup?.buckets?.find(
            (b) => b.displayName?.toLowerCase().includes("weekly") || b.bucketId?.includes("weekly") || b.window === "weekly",
          );

          const tp5h = thirdPartyGroup?.buckets?.find(
            (b) => b.displayName?.toLowerCase().includes("five hour") || b.bucketId?.includes("5h") || b.window === "5h",
          );
          const tpWeekly = thirdPartyGroup?.buckets?.find(
            (b) => b.displayName?.toLowerCase().includes("weekly") || b.bucketId?.includes("weekly") || b.window === "weekly",
          );

          const argonWeekly = argonGroup?.buckets?.find(
            (b) => b.displayName?.toLowerCase().includes("weekly") || b.bucketId?.includes("weekly") || b.window === "weekly",
          );

          const primaryWindow = toWindow(gemini5h, "Gemini Models", "5-Hour limit", 300) || {
            label: "5-Hour limit",
            group: "Gemini Models",
            percentLeft: 100,
            usedPercent: 0,
            windowDurationMins: 300,
          };

          const secondaryWindow = toWindow(geminiWeekly, "Gemini Models", "Weekly limit", 10080);

          const extraWindows = [
            toWindow(tp5h, "Claude and GPT models", "5-Hour limit", 300),
            toWindow(tpWeekly, "Claude and GPT models", "Weekly limit", 10080),
            argonWeekly ? toWindow(argonWeekly, "Gemini 4 Argon", "Weekly limit", 10080) : undefined,
          ].filter(Boolean) as AcpQuotaLimitWindow[];

          return {
            runtimeId,
            provider: "Google Antigravity",
            account: {
              email: acc.email,
              name: acc.name || (acc.email ? acc.email.split("@")[0] : "Google Developer"),
              plan: "Google AI Pro",
              type: "gemini",
            },
            primaryWindow,
            secondaryWindow,
            extraWindows: extraWindows.length > 0 ? extraWindows : undefined,
            credits: {
              unlimited: true,
              balance: "unlimited",
            },
            status: "ok",
            updatedAt: Date.now(),
          };
        }
      }
    } catch (e: any) {
      console.warn("[AgyQuota] Live probe failed:", e.message);
    }
  }

  return null;
}
