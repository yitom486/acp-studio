/**
 * 全局测试环境（vitest setupFiles，先于每个测试文件执行）。
 * 固定网关令牌，避免读写真实 ~/.acp-studio/.gateway-token。
 */
import { TEST_GATEWAY_TOKEN } from "./helpers/gateway-auth";

process.env.ACP_GATEWAY_TOKEN = TEST_GATEWAY_TOKEN;
