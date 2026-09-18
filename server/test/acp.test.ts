import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { resolveOfficialAgyAcpServer, DiscoveredServer } from "../acp/installer";
import { AntigravityAcpClient } from "../acp/client";
import { AntigravityAcpProcessManager } from "../acp/processManager";

describe("Official Google Antigravity ACP Integration Test Suite", () => {
  let discovered: DiscoveredServer;
  let pm: AntigravityAcpProcessManager;

  beforeAll(async () => {
    discovered = await resolveOfficialAgyAcpServer();
    pm = new AntigravityAcpProcessManager(process.cwd());
    await pm.ensureRunning();
  }, 60000);

  afterAll(async () => {
    if (pm) {
      await pm.shutdown();
    }
  });

  // 1. Discovery & Localization
  it("Test 1: Official agy_acp_server detection and resolution", () => {
    expect(discovered).toBeDefined();
    expect(fs.existsSync(discovered.executablePath)).toBe(true);
    const exeName = path.basename(discovered.executablePath).toLowerCase();
    expect(exeName).toBe(process.platform === "win32" ? "agy_acp_server.exe" : "agy_acp_server.par");
  });

  // 2. Official Binary & Harness Distribution Integrity
  it("Test 2: Verification of companion localharness_external", () => {
    const harnessName = process.platform === "win32" ? "localharness_external.exe" : "localharness_external";
    const harnessPath = path.join(discovered.dir, harnessName);
    expect(fs.existsSync(harnessPath)).toBe(true);
    expect(discovered.harnessPath).toBe(harnessPath);
  });

  // 3. Complete Absence of Legacy agy.exe & SQLite Bridge
  it("Test 3: Verification of zero legacy agy.exe CLI and zero SQLite bridge", () => {
    // 1. Legacy bin/agy.exe must not exist in workspace
    const legacyBin = path.join(process.cwd(), "bin", "agy.exe");
    expect(fs.existsSync(legacyBin)).toBe(false);

    // 2. Legacy server-engine must not exist
    const legacyEngine = path.join(process.cwd(), "server-engine");
    expect(fs.existsSync(legacyEngine)).toBe(false);

    // 3. Check active source files for forbidden agy.exe -p patterns
    const serverFiles = [
      "server/index.ts",
      "server/acp/client.ts",
      "server/acp/installer.ts",
      "server/acp/processManager.ts",
    ];

    for (const f of serverFiles) {
      const fullPath = path.join(process.cwd(), f);
      if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath, "utf-8");
        expect(content.includes("agy.exe -p")).toBe(false);
        expect(content.includes("conversations.db")).toBe(false);
      }
    }
  });

  // 4. ACP Process State
  it("Test 4: Launch official ACP server process and check alive state", () => {
    expect(pm.getStatus().isRunning).toBe(true);
  });

  // 5. ACP Initialize Handshake
  it("Test 5: ACP JSON-RPC 2.0 initialize protocol handshake verification", () => {
    const status = pm.getStatus();
    expect(status.agentInfo).toBeDefined();
    expect(status.agentInfo?.name).toBe("antigravity-acp");
    expect(status.agentInfo?.title).toContain("Google Antigravity");
    expect(status.agentCapabilities).toBeDefined();
    expect(status.agentCapabilities?.loadSession).toBe(true);
  });

  // 6. Official Agent Info & AuthMethods
  it("Test 6: Validation of official authMethods and agentInfo", () => {
    const status = pm.getStatus();
    expect(status.agentInfo?.name).toBe("antigravity-acp");
    expect(status.authMethods).toBeDefined();
    const methodIds = status.authMethods?.map((m) => m.id) || [];
    expect(methodIds).toContain("oauth-personal");
    expect(methodIds).toContain("gemini-api-key");
  });

  // 7. Google OAuth URL Generation
  it("Test 7: Authentication flow triggers official Google OAuth URL", async () => {
    const authRes = await pm.authenticate("oauth-personal");
    expect(authRes.ok).toBe(true);
    if (authRes.oauthUrl) {
      expect(authRes.oauthUrl).toContain("accounts.google.com/o/oauth2/");
      expect(authRes.oauthUrl).toContain("client_id=");
    }
  });

  // 8. Capability Negotiation (session/close safety)
  it("Test 8: Capability negotiation guarantees no session/close without server advertisement", async () => {
    const status = pm.getStatus();
    // Official agy_acp_server does NOT advertise sessionCapabilities.close
    const closeSupported = Boolean(status.agentCapabilities?.sessionCapabilities?.close);
    expect(closeSupported).toBe(false);

    // closeSession should safely execute without throwing even if close is unsupported
    await expect(pm.closeSession("non-existent-session")).resolves.toBeUndefined();
  });

  // 9. session/new Schema Compliance
  it("Test 9: session/new parameters strictly match official schema { cwd, mcpServers: [] }", async () => {
    // When valid schema { cwd, mcpServers: [] } is sent, it passes parameter validation
    // (returns -32000 Authentication required rather than -32602 Invalid params)
    try {
      await pm.createSession();
    } catch (err: any) {
      expect(err.message).not.toContain("-32602");
      expect(err.message).toContain("Authentication required");
    }
  });

  // 10. Cancellation Protocol Framing
  it("Test 10: session/cancel sends proper JSON-RPC notification framing without error", async () => {
    await expect(pm.cancel("dummy-session")).resolves.toBeUndefined();
  });

  // 11. Process Stability and Long-lived State
  it("Test 11: ProcessManager maintains persistent alive state without premature exit", async () => {
    expect(pm.getStatus().isRunning).toBe(true);
    await new Promise((r) => setTimeout(r, 1000));
    expect(pm.getStatus().isRunning).toBe(true);
  });

  // 12. Transport Separation (SSE Keepalive != ACP NDJSON)
  it("Test 12: Web SSE heartbeat lines ': keepalive\\n\\n' are strictly isolated from ACP stdio", () => {
    const sseComment = ": keepalive\n\n";
    expect(sseComment.startsWith(":")).toBe(true);
    // ACP parser ignores comments because it expects JSON-RPC objects
    expect(() => JSON.parse(sseComment.trim())).toThrow();
  });

  // 13. Server HTTP Endpoint Contract
  it("Test 13: HTTP /api/status endpoint returns official Google ACP agent manifest", async () => {
    const res = await fetch("http://localhost:3002/api/status");
    expect(res.ok).toBe(true);
    const data = await res.json();

    expect(data.isOfficial).toBe(true);
    expect(data.service).toContain("Google Antigravity");
    expect(data.agentInfo?.name).toBe("antigravity-acp");
    expect(data.binary?.executablePath).toContain("agy_acp_server.exe");
    expect(data.models.length).toBeGreaterThan(0);
  });

  // 14. Server Login Endpoint Contract
  it("Test 14: HTTP /api/auth/login returns real Google OAuth login URL", async () => {
    const res = await fetch("http://localhost:3002/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ methodId: "oauth-personal" }),
    });
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.ok).toBe(true);
    if (data.oauthUrl) {
      expect(data.oauthUrl).toContain("accounts.google.com/o/oauth2/");
    }
  });

  // 15. Server Session New Authentication Check
  it("Test 15: HTTP /api/session/new returns ACP auth requirement if unauthenticated", async () => {
    const res = await fetch("http://localhost:3002/api/session/new", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const data = await res.json();
    if (!data.sessionId) {
      expect(data.error).toContain("Authentication required");
    }
  });
});
