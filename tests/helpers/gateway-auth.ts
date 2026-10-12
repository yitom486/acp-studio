/**
 * 测试用网关令牌。vitest setupFiles（tests/setup-env.ts）在任何被测模块加载前
 * 把它写进 ACP_GATEWAY_TOKEN，ensureGatewayToken() 因此直接采用它、不落盘。
 */
export const TEST_GATEWAY_TOKEN = "test-gateway-token-0123456789abcdef";

/** 带有效 Bearer 令牌的 Request（与 `new Request` 同签名）。 */
export function authedRequest(input: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  if (!headers.has("Authorization")) headers.set("Authorization", `Bearer ${TEST_GATEWAY_TOKEN}`);
  return new Request(input, { ...init, headers });
}
