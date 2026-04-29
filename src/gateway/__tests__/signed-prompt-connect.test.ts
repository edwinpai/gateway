import { describe, it, expect } from "vitest";
import { resolveScopesFromSignedPrompt } from "../signed-prompt-scopes.js";
import { resolveScopesFromTokens } from "../signed-prompt-tokens.js";

const signedPrompt = {
  envelope: {
    version: "edwinpai/1",
    issuedAt: Date.now(),
    nonce: "nonce",
    promptHash: "hash",
    scopeClaims: ["operator.read"],
    certHash: "hash",
    permissionTokens: [{ scope: "operator.read", certHash: "hash" }],
  },
  signature: "sig",
};

describe("signed prompt connect checks", () => {
  it("rejects when requested scopes exceed scope claims", () => {
    const result = resolveScopesFromSignedPrompt(signedPrompt, ["operator.read", "operator.write"]);
    expect(result.ok).toBe(false);
  });

  it("rejects when permission token certHash mismatch", () => {
    const result = resolveScopesFromTokens({
      requestedScopes: ["operator.read"],
      tokens: signedPrompt.envelope.permissionTokens ?? [],
      certHash: "other",
    });
    expect(result.ok).toBe(false);
  });
});
