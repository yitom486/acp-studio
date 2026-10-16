/**
 * 全局测试环境（vitest setupFiles，先于每个测试文件及其被测模块执行）。
 * 测试绝不碰真实用户目录：
 * - 固定网关令牌（ACP_GATEWAY_TOKEN），不读写 ~/.acp-studio/.gateway-token；
 * - 自定义智能体文件（ACP_AGENTS_FILE）与智能体安装目录（ACP_AGENTS_HOME）
 *   指向每个 worker 独立的临时目录，不写 ~/.acp-studio/agents.json。
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { TEST_GATEWAY_TOKEN } from "./helpers/gateway-auth";

process.env.ACP_GATEWAY_TOKEN = TEST_GATEWAY_TOKEN;

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "acp-studio-test-home-"));
process.env.ACP_AGENTS_FILE = path.join(sandbox, "agents.json");
process.env.ACP_AGENTS_HOME = path.join(sandbox, "agents");
process.env.ACP_STUDIO_RESOURCES_DIR = path.join(sandbox, "app-resources");

process.on("exit", () => {
  fs.rmSync(sandbox, { recursive: true, force: true });
});
