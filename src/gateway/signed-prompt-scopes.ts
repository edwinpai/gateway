import type { SignedPrompt } from "../types/bsv-auth.js";

export type ScopeResolutionResult =
  | { ok: true; scopes: string[] }
  | { ok: false; scopes: string[]; reason: string };

export function resolveScopesFromSignedPrompt(
  signedPrompt: SignedPrompt | undefined,
  requestedScopes: string[],
): ScopeResolutionResult {
  const claims = Array.isArray(signedPrompt?.envelope?.scopeClaims)
    ? signedPrompt?.envelope?.scopeClaims
    : [];

  if (claims.length === 0) {
    return { ok: true, scopes: requestedScopes };
  }

  const allowed = new Set(claims);
  const disallowed = requestedScopes.filter((scope) => !allowed.has(scope));
  if (disallowed.length > 0) {
    return {
      ok: false,
      scopes: claims,
      reason: `scopes not authorized by signed prompt: ${disallowed.join(", ")}`,
    };
  }

  return { ok: true, scopes: claims };
}
