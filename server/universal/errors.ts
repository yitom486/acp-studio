/**
 * ACP error-code helpers (mirror of the protocol schema `ErrorCode`).
 * Agents report failures as JSON-RPC errors; the SDK surfaces them as
 * RequestError instances carrying the numeric `code`. Prefer codes over
 * message sniffing; the regex is only a fallback for agents that flatten
 * errors into plain messages.
 */

/** ACP "Authentication required" (-32000, reserved ACP range -32000..-32099). */
export const ACP_ERROR_AUTH_REQUIRED = -32000;

/** ACP "Request cancelled" (-32800). */
export const ACP_ERROR_REQUEST_CANCELLED = -32800;

export function acpErrorCode(err: unknown): number | null {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "number" ? code : null;
}

export function isAuthRequiredError(err: unknown): boolean {
  if (acpErrorCode(err) === ACP_ERROR_AUTH_REQUIRED) return true;
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return /auth_required|authentication required|need[s]? (to )?auth|unauthenticated|not (authenticated|logged in)|login required/i.test(msg);
}

export function isCancelError(err: unknown): boolean {
  if (acpErrorCode(err) === ACP_ERROR_REQUEST_CANCELLED) return true;
  return (err as Error)?.name === "AbortError";
}
