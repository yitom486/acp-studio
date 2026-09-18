import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

export const ACP_REGISTRY_AGENT_URL =
  "https://raw.githubusercontent.com/agentclientprotocol/registry/main/antigravity-acp/agent.json";

export interface AcpRegistryEntry {
  id: string;
  name: string;
  version: string;
  description: string;
  website: string;
  authors: string[];
  license: string;
  license_url: string;
  distribution: {
    binary: Record<
      string,
      {
        archive: string;
        cmd: string;
        args?: string[];
      }
    >;
  };
}

export interface DiscoveredServer {
  executablePath: string;
  dir: string;
  version: string;
  source: "env" | "zed_cache" | "app_cache" | "downloaded";
  harnessPath?: string;
}

/**
 * Locate the official Google agy_acp_server binary according to ACP Registry specifications.
 */
export async function resolveOfficialAgyAcpServer(): Promise<DiscoveredServer> {
  const exeName = process.platform === "win32" ? "agy_acp_server.exe" : "agy_acp_server.par";
  const harnessName = process.platform === "win32" ? "localharness_external.exe" : "localharness_external";

  // 1. Explicit Environment Variable
  if (process.env.AGY_ACP_SERVER_PATH) {
    const p = process.env.AGY_ACP_SERVER_PATH;
    if (fs.existsSync(p)) {
      const dir = path.dirname(p);
      return {
        executablePath: p,
        dir,
        version: "custom-env",
        source: "env",
        harnessPath: fs.existsSync(path.join(dir, harnessName)) ? path.join(dir, harnessName) : undefined,
      };
    }
  }

  // 2. Discover from Zed ACP Registry Cache (if Zed installed it on this machine)
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  const zedRegistryDir = path.join(localAppData, "Zed", "external_agents", "registry", "antigravity-acp");
  if (fs.existsSync(zedRegistryDir)) {
    try {
      const subdirs = fs.readdirSync(zedRegistryDir);
      for (const sub of subdirs) {
        const candidateDir = path.join(zedRegistryDir, sub);
        const candidateExe = path.join(candidateDir, exeName);
        if (fs.existsSync(candidateExe)) {
          const harnessPath = path.join(candidateDir, harnessName);
          return {
            executablePath: candidateExe,
            dir: candidateDir,
            version: sub.split("_")[1] || "1.1.1",
            source: "zed_cache",
            harnessPath: fs.existsSync(harnessPath) ? harnessPath : undefined,
          };
        }
      }
    } catch {
      // ignore
    }
  }

  // 3. Discover from App Cache / Runtime Dir
  const appRuntimeDir = path.join(os.homedir(), ".gemini", "antigravity-acp", "runtime");
  const appCacheExe = path.join(appRuntimeDir, exeName);
  if (fs.existsSync(appCacheExe)) {
    return {
      executablePath: appCacheExe,
      dir: appRuntimeDir,
      version: "1.1.1",
      source: "app_cache",
      harnessPath: fs.existsSync(path.join(appRuntimeDir, harnessName))
        ? path.join(appRuntimeDir, harnessName)
        : undefined,
    };
  }

  // 4. Download and bootstrap from official ACP Registry distribution
  console.log("[ACP Installer] Official binary not found locally, fetching registry info from:", ACP_REGISTRY_AGENT_URL);
  let registry: AcpRegistryEntry;
  try {
    const res = await fetch(ACP_REGISTRY_AGENT_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    registry = (await res.json()) as AcpRegistryEntry;
  } catch (err: any) {
    throw new Error(`Failed to fetch official ACP registry metadata: ${err.message}`);
  }

  const platformKey =
    process.platform === "win32"
      ? process.arch === "arm64"
        ? "windows-aarch64"
        : "windows-x86_64"
      : process.platform === "darwin"
      ? "darwin-aarch64"
      : process.arch === "arm64"
      ? "linux-aarch64"
      : "linux-x86_64";

  const dist = registry.distribution?.binary?.[platformKey];
  if (!dist || !dist.archive) {
    throw new Error(`No official binary distribution found in ACP registry for platform: ${platformKey}`);
  }

  console.log(`[ACP Installer] Downloading official distribution for ${platformKey} from: ${dist.archive}`);
  fs.mkdirSync(appRuntimeDir, { recursive: true });

  const tempZip = path.join(appRuntimeDir, "dist.zip");
  const archiveRes = await fetch(dist.archive);
  if (!archiveRes.ok) {
    throw new Error(`Failed to download official distribution archive: HTTP ${archiveRes.status}`);
  }

  const fileData = await archiveRes.arrayBuffer();
  fs.writeFileSync(tempZip, Buffer.from(fileData));

  // Unzip archive
  console.log("[ACP Installer] Extracting official Google ACP server archive...");
  if (process.platform === "win32") {
    // Use tar or powershell
    const proc = Bun.spawn(
      ["tar", "-xf", tempZip, "-C", appRuntimeDir],
      { stderr: "inherit" }
    );
    await proc.exited;
  }

  // Clean temp zip
  try {
    fs.unlinkSync(tempZip);
  } catch {
    // ignore
  }

  if (!fs.existsSync(appCacheExe)) {
    throw new Error(
      `Installation failed: executable ${exeName} not found in ${appRuntimeDir} after extraction.`
    );
  }

  return {
    executablePath: appCacheExe,
    dir: appRuntimeDir,
    version: registry.version || "1.1.1",
    source: "downloaded",
    harnessPath: fs.existsSync(path.join(appRuntimeDir, harnessName))
      ? path.join(appRuntimeDir, harnessName)
      : undefined,
  };
}
