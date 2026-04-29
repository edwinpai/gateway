import { describe, expect, it } from "vitest";
import { createIdentityCoreFromBinding } from "../packages/identity-core/src/binding.js";

describe("identity-core binding adapter", () => {
  it("uses getIdentity as a fallback for getPublicKey", async () => {
    const core = createIdentityCoreFromBinding({
      async getIdentity() {
        return {
          publicKey: "02abcdef",
          shortId: "edw:12345678",
        };
      },
      async signChallenge() {
        return {
          publicKey: "02abcdef",
          signature: "deadbeef",
          shortId: "edw:12345678",
        };
      },
    });

    await expect(core.getPublicKey()).resolves.toBe("02abcdef");
  });

  it("passes through signChallenge", async () => {
    const core = createIdentityCoreFromBinding({
      async getIdentity() {
        return {
          publicKey: "02abcdef",
        };
      },
      async signChallenge(challenge) {
        return {
          publicKey: "02abcdef",
          signature: `sig:${challenge}`,
          shortId: "edw:12345678",
        };
      },
    });

    await expect(core.signChallenge("hello")).resolves.toEqual({
      publicKey: "02abcdef",
      signature: "sig:hello",
      shortId: "edw:12345678",
    });
  });

  it("throws for operations the binding does not implement", async () => {
    const core = createIdentityCoreFromBinding({
      async getIdentity() {
        return {
          publicKey: "02abcdef",
        };
      },
      async signChallenge() {
        return {
          publicKey: "02abcdef",
          signature: "deadbeef",
          shortId: "edw:12345678",
        };
      },
    });

    await expect(core.signEnvelope({ payload: "hello" })).rejects.toThrow(
      "IdentityCoreBinding does not implement signEnvelope()",
    );
  });
});
