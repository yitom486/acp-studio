#!/usr/bin/env bun
/**
 * Antigravity ACP Stdio Server for Zed, Claude Desktop, and CLI clients.
 * Powered by agy-acp-map (@agentclientprotocol/sdk) with direct Google Antigravity CLI integration.
 * Zero %TEMP% disk extraction, instant startup, full ACP v1/v2 compatibility.
 */
import { Readable, Writable } from "node:stream";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import * as acp from "@agentclientprotocol/sdk";
import { createDualAcpApp, AgyAcpService } from "@yitom/agy-acp-map";

// Auto-detect Google Antigravity CLI binary location
if (!process.env.AGY_BIN) {
  const candidate = path.join(os.homedir(), ".gemini", "bin", process.platform === "win32" ? "agy.exe" : "agy");
  if (fs.existsSync(candidate)) {
    process.env.AGY_BIN = candidate;
    process.stderr.write(`[Antigravity ACP Stdio] Auto-detected AGY_BIN: ${candidate}\n`);
  }
}
const geminiBinDir = path.join(os.homedir(), ".gemini", "bin");
if (fs.existsSync(geminiBinDir) && !process.env.PATH?.includes(geminiBinDir)) {
  process.env.PATH = `${geminiBinDir}${path.delimiter}${process.env.PATH || ""}`;
}

// Write all diagnostic/debug info strictly to STDERR so that STDOUT remains pure JSON-RPC 2.0
process.stderr.write("[Antigravity ACP Stdio] Initializing ACP Stdio Server for Zed...\n");

const service = new AgyAcpService();
const app = createDualAcpApp(service);

const stream = acp.ndJsonStream(
  Writable.toWeb(process.stdout) as unknown as WritableStream<Uint8Array>,
  Readable.toWeb(process.stdin) as unknown as ReadableStream<Uint8Array>
);

process.stderr.write("[Antigravity ACP Stdio] Connected to Stdio stream. Ready to accept requests.\n");

try {
  await app.connect(stream);
} catch (err: any) {
  process.stderr.write(`[Antigravity ACP Stdio] Fatal stream error: ${err?.message || err}\n`);
  process.exit(1);
}
