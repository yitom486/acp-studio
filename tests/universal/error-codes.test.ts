import { describe, it, expect } from "vitest";
import {
  ACP_ERROR_AUTH_REQUIRED,
  acpErrorCode,
  isAuthRequiredError,
  GatewayError,
} from "../../src/lib/universal-api";
import {
  isAuthRequiredError as serverIsAuth,
  acpErrorCode as serverCode,
} from "../../server/universal/errors";

describe("ACP error codes (-32000 auth)", () => {
  it("exposes the protocol auth code", () => {
    expect(ACP_ERROR_AUTH_REQUIRED).toBe(-32000);
  });

  it("detects auth failures by code first", () => {
    const coded = new GatewayError("nope", { authRequired: false, status: 500, code: -32000 });
    expect(acpErrorCode(coded)).toBe(-32000);
    expect(isAuthRequiredError(coded)).toBe(true);
    expect(serverCode(coded)).toBe(-32000);
    expect(serverIsAuth(coded)).toBe(true);
  });

  it("detects auth failures by gateway flag", () => {
    expect(isAuthRequiredError(new GatewayError("denied", { authRequired: true, status: 401 }))).toBe(true);
  });

  it("falls back to message matching for flattened errors", () => {
    expect(isAuthRequiredError(new Error("Authentication required"))).toBe(true);
    expect(serverIsAuth(new Error("auth_required"))).toBe(true);
    expect(isAuthRequiredError(new Error("Internal error"))).toBe(false);
    expect(serverIsAuth(new Error("Internal error"))).toBe(false);
    expect(acpErrorCode(new Error("plain"))).toBeNull();
  });
});
