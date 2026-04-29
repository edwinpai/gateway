/**
 * Identity-core seam boundary guardrail.
 *
 * Production source files that directly import the protected identity
 * primitives must stay on the explicit allowlist below. New consumers
 * must go through `@edwinpai/identity-core` (the node-binding seam),
 * not reach in to the underlying helpers.
 *
 * If this test fails, route the new consumer through `createNodeIdentityCoreBinding`
 * instead of importing the primitive directly. If the new file genuinely
 * is a transport adapter or the underlying primitive itself, add it to
 * the allowlist with a comment explaining why.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_SRC = join(__dirname);

const PROTECTED_SYMBOLS = [
  "verifySignedRequest",
  "verifySignatureUnified",
  "RequestSigner",
  "createSignedEnvelope",
];

const PROTECTED_MODULES = ["auth/verification", "auth/request-signer", "infra/signed-envelope"];

const ALLOWED_DIRECT_IMPORT_FILES = new Set<string>([
  "auth/verification.ts",
  "auth/request-signer.ts",
  "infra/signed-envelope.ts",
  "auth/index.ts",
  "auth/identity.ts",
  "auth/request-authorizer.ts",
  "auth/brc107-middleware.ts",
  "auth/middleware.ts",
  "auth/signing.ts",
  "client/edwinpai-client.ts",
  "gateway/gateway-http-client.ts",
  "gateway/call.ts",
]);

function listProductionTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === "__tests__") continue;
      out.push(...listProductionTsFiles(full));
      continue;
    }
    if (!entry.endsWith(".ts")) continue;
    if (entry.endsWith(".test.ts")) continue;
    if (entry.endsWith(".d.ts")) continue;
    out.push(full);
  }
  return out;
}

function importsProtectedPrimitive(content: string): boolean {
  for (const mod of PROTECTED_MODULES) {
    const re = new RegExp(`from\\s+["'][^"']*${mod}(\\.js)?["']`);
    if (re.test(content)) {
      return true;
    }
  }
  for (const sym of PROTECTED_SYMBOLS) {
    const re = new RegExp(`\\b${sym}\\b`);
    if (re.test(content)) {
      return true;
    }
  }
  return false;
}

describe("identity-core seam boundary", () => {
  it("only seam-internal files import protected identity primitives", () => {
    const offenders: string[] = [];
    for (const file of listProductionTsFiles(REPO_SRC)) {
      const rel = relative(REPO_SRC, file).replaceAll("\\", "/");
      if (ALLOWED_DIRECT_IMPORT_FILES.has(rel)) continue;
      const content = readFileSync(file, "utf-8");
      if (importsProtectedPrimitive(content)) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });
});
