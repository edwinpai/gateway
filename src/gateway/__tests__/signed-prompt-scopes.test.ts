import { describe, it, expect } from "vitest";
import type { SignedPrompt } from "../../types/bsv-auth.js";
import { resolveScopesFromSignedPrompt } from "../signed-prompt-scopes.js";

const basePrompt: SignedPrompt = {
  envelope: {
    version: "edwinpai/1",
    issuedAt: Date.now(),
    nonce: "nonce",
    promptHash: "hash",
  },
  signature: "sig",
};

describe("resolveScopesFromSignedPrompt", () => {
  it("allows requested scopes when no scope claims provided", () => {
    const result = resolveScopesFromSignedPrompt(basePrompt, ["operator.read"]);
    expect(result.ok).toBe(true);
  });

  it("allows when requested scopes are within claims", () => {
    const prompt: SignedPrompt = {
      ...basePrompt,
      envelope: {
        ...basePrompt.envelope,
        scopeClaims: ["operator.read", "operator.write"],
      },
    };
    const result = resolveScopesFromSignedPrompt(prompt, ["operator.read"]);
    expect(result.ok).toBe(true);
  });

  it("rejects when requested scopes exceed claims", () => {
    const prompt: SignedPrompt = {
      ...basePrompt,
      envelope: {
        ...basePrompt.envelope,
        scopeClaims: ["operator.read"],
      },
    };
    const result = resolveScopesFromSignedPrompt(prompt, ["operator.read", "operator.write"]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("operator.write");
    }
  });
});
