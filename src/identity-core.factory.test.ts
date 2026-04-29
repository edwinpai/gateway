import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IdentityCore } from "../packages/identity-core/src/types.js";
import { IdentityCoreUnavailableError } from "../packages/identity-core/src/errors.js";
import { createIdentityCore } from "../packages/identity-core/src/factory.js";

function makeImplementation(label: string): IdentityCore {
  return {
    async hasIdentity() {
      return true;
    },
    async getIdentity() {
      return {
        publicKey: `pub:${label}`,
        shortId: `id:${label}`,
      };
    },
    async getPublicKey() {
      return `pub:${label}`;
    },
    async derivePublicKey() {
      return {
        publicKey: `derived:${label}`,
      };
    },
    async signHttpRequest() {
      return {
        "x-bsv-identity-key": `key:${label}`,
        "x-bsv-signature": `sig:${label}`,
        "x-bsv-timestamp": "1",
        "x-bsv-nonce": `nonce:${label}`,
      };
    },
    async signMessage(input) {
      return {
        signature: `sig:${input.message}:${label}`,
      };
    },
    async signEnvelope(input) {
      return {
        payload: input.payload,
        envelope: {
          kid: `kid:${label}`,
          alg: "ES256K",
          iat: 1,
          exp: 2,
          nonce: `nonce:${label}`,
          payloadHash: `hash:${label}`,
          sig: `sig:${label}`,
          pubKey: `pub:${label}`,
        },
      };
    },
    async signChallenge(challenge) {
      return {
        publicKey: `pub:${label}`,
        signature: `sig:${challenge}:${label}`,
        shortId: `id:${label}`,
      };
    },
    async verifyEnvelope() {
      return {
        valid: true,
        pubKey: `pub:${label}`,
        kid: `kid:${label}`,
      };
    },
    async verifySignature() {
      return {
        valid: true,
      };
    },
    async verifyRequest() {
      return {
        valid: true,
        verifiedAt: 1,
      };
    },
  };
}

afterEach(() => {
  delete process.env.EDWINPAI_IDENTITY_CORE_MODULE;
  vi.restoreAllMocks();
});

describe("identity-core factory", () => {
  it("explicit implementation wins", async () => {
    const implementation = makeImplementation("direct");
    const loadImplementation = vi.fn(async () => makeImplementation("loader"));

    const core = createIdentityCore({
      implementation,
      loadImplementation,
      nativeModuleName: "./does-not-matter.js",
    });

    await expect(core.getPublicKey()).resolves.toBe("pub:direct");
    expect(loadImplementation).not.toHaveBeenCalled();
  });

  it("loadImplementation success works lazily", async () => {
    const loadImplementation = vi.fn(async () => makeImplementation("lazy"));

    const core = createIdentityCore({ loadImplementation });

    expect(loadImplementation).not.toHaveBeenCalled();
    await expect(core.getPublicKey()).resolves.toBe("pub:lazy");
    expect(loadImplementation).toHaveBeenCalledTimes(1);
    await expect(core.getIdentity()).resolves.toEqual({
      publicKey: "pub:lazy",
      shortId: "id:lazy",
    });
    expect(loadImplementation).toHaveBeenCalledTimes(1);
  });

  it("missing wiring fails closed with IdentityCoreUnavailableError on first method use", async () => {
    const core = createIdentityCore();

    await expect(core.hasIdentity()).resolves.toBe(false);
    await expect(core.getPublicKey()).rejects.toBeInstanceOf(IdentityCoreUnavailableError);
    await expect(core.getPublicKey()).rejects.toThrow("not wired yet");
  });

  it("loader failure fails closed and includes original error context", async () => {
    const core = createIdentityCore({
      loadImplementation: async () => {
        throw new Error("boom from loader");
      },
    });

    await expect(core.getIdentity()).rejects.toBeInstanceOf(IdentityCoreUnavailableError);
    await expect(core.getIdentity()).rejects.toThrow("implementation loader failed");
    await expect(core.getIdentity()).rejects.toThrow("boom from loader");
  });

  it("native/module hook path works by loading a temp module", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "identity-core-module-"));
    const modulePath = path.join(tempDir, "identity-core-test-module.mjs");

    await fs.writeFile(
      modulePath,
      `export default {
        async hasIdentity() { return true; },
        async getIdentity() { return { publicKey: "pub:module", shortId: "id:module" }; },
        async getPublicKey() { return "pub:module"; },
        async derivePublicKey() { return { publicKey: "derived:module" }; },
        async signHttpRequest() {
          return {
            "x-bsv-identity-key": "key:module",
            "x-bsv-signature": "sig:module",
            "x-bsv-timestamp": "1",
            "x-bsv-nonce": "nonce:module",
          };
        },
        async signMessage(input) {
          return { signature: "sig:" + input.message + ":module" };
        },
        async signEnvelope(input) {
          return {
            payload: input.payload,
            envelope: {
              kid: "kid:module",
              alg: "ES256K",
              iat: 1,
              exp: 2,
              nonce: "nonce:module",
              payloadHash: "hash:module",
              sig: "sig:module",
              pubKey: "pub:module",
            },
          };
        },
        async signChallenge(challenge) {
          return {
            publicKey: "pub:module",
            signature: "sig:" + challenge + ":module",
            shortId: "id:module",
          };
        },
        async verifyEnvelope() { return { valid: true, pubKey: "pub:module", kid: "kid:module" }; },
        async verifySignature() { return { valid: true }; },
        async verifyRequest() { return { valid: true, verifiedAt: 1 }; },
      };
      `,
      "utf8",
    );

    try {
      const core = createIdentityCore({
        nativeModuleName: pathToFileURL(modulePath).href,
      });

      await expect(core.getPublicKey()).resolves.toBe("pub:module");
      await expect(core.getIdentity()).resolves.toEqual({
        publicKey: "pub:module",
        shortId: "id:module",
      });
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
