import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  getIdentityCoreCompanionPackageName,
  getIdentityCoreNativeRuntimeTriple,
  loadNativeIdentityCore,
  NATIVE_PATH_ENV,
} from "../packages/identity-core/src/native-loader.js";

afterEach(() => {
  delete process.env[NATIVE_PATH_ENV];
});

describe("identity-core native loader", () => {
  it("returns null when no native artifact is wired", () => {
    expect(loadNativeIdentityCore({ envPath: undefined, bundledPath: undefined })).toBeNull();
  });

  it("loads a native identity core from the env path override", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "identity-core-native-"));
    const modulePath = path.join(tempDir, "identity-core.cjs");

    await fs.writeFile(
      modulePath,
      `module.exports = {
        getIdentity: async () => ({ publicKey: "pub:env", shortId: "id:env" }),
        getPublicKey: async () => "pub:env",
        hasIdentity: async () => true,
        derivePublicKey: async () => ({ publicKey: "derived:env" }),
        signHttpRequest: async () => ({
          "x-bsv-identity-key": "key:env",
          "x-bsv-signature": "sig:env",
          "x-bsv-timestamp": "1",
          "x-bsv-nonce": "nonce:env",
        }),
        signEnvelope: async (input) => ({
          payload: input.payload,
          envelope: {
            kid: "kid:env",
            alg: "ES256K",
            iat: 1,
            exp: 2,
            nonce: "nonce:env",
            payloadHash: "hash:env",
            sig: "sig:env",
            pubKey: "pub:env",
          },
        }),
        signChallenge: async () => ({ publicKey: "pub:env", signature: "sig:env" }),
        verifyEnvelope: async () => ({ valid: true }),
        verifySignature: async () => ({ valid: true }),
        verifyRequest: async () => ({ valid: true, verifiedAt: 1 }),
      };
      `,
      "utf8",
    );

    try {
      process.env[NATIVE_PATH_ENV] = modulePath;
      const core = loadNativeIdentityCore();
      expect(core).not.toBeNull();
      await expect(core?.getPublicKey()).resolves.toBe("pub:env");
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("supports createIdentityCoreNative() exports", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "identity-core-native-factory-"));
    const modulePath = path.join(tempDir, "identity-core-factory.cjs");

    await fs.writeFile(
      modulePath,
      `module.exports.createIdentityCoreNative = () => ({
        getIdentity: async () => ({ publicKey: "pub:factory", shortId: "id:factory" }),
        getPublicKey: async () => "pub:factory",
        hasIdentity: async () => true,
        derivePublicKey: async () => ({ publicKey: "derived:factory" }),
        signHttpRequest: async () => ({
          "x-bsv-identity-key": "key:factory",
          "x-bsv-signature": "sig:factory",
          "x-bsv-timestamp": "1",
          "x-bsv-nonce": "nonce:factory",
        }),
        signEnvelope: async (input) => ({
          payload: input.payload,
          envelope: {
            kid: "kid:factory",
            alg: "ES256K",
            iat: 1,
            exp: 2,
            nonce: "nonce:factory",
            payloadHash: "hash:factory",
            sig: "sig:factory",
            pubKey: "pub:factory",
          },
        }),
        signChallenge: async () => ({ publicKey: "pub:factory", signature: "sig:factory" }),
        verifyEnvelope: async () => ({ valid: true }),
        verifySignature: async () => ({ valid: true }),
        verifyRequest: async () => ({ valid: true, verifiedAt: 1 }),
      });
      `,
      "utf8",
    );

    try {
      const core = loadNativeIdentityCore({ envPath: modulePath });
      expect(core).not.toBeNull();
      await expect(core?.getIdentity()).resolves.toEqual({
        publicKey: "pub:factory",
        shortId: "id:factory",
      });
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("resolves an installed companion package entrypoint by runtime triple", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "identity-core-native-companion-"));
    const modulePath = path.join(tempDir, "identity-core.node");

    await fs.writeFile(modulePath, "placeholder", "utf8");

    const resolveCalls: string[] = [];

    try {
      const core = loadNativeIdentityCore({
        envPath: undefined,
        bundledPath: undefined,
        stagedPath: undefined,
        platform: "linux",
        arch: "x64",
        resolveFn: (specifier) => {
          resolveCalls.push(specifier);
          return modulePath;
        },
        requireFn: () => ({
          default: {
            hasIdentity: async () => true,
            getIdentity: async () => ({ publicKey: "pub:companion", shortId: "id:companion" }),
            getPublicKey: async () => "pub:companion",
            derivePublicKey: async () => ({ publicKey: "derived:companion" }),
            signHttpRequest: async () => ({
              "x-bsv-identity-key": "key:companion",
              "x-bsv-signature": "sig:companion",
              "x-bsv-timestamp": "1",
              "x-bsv-nonce": "nonce:companion",
            }),
            signEnvelope: async () => {
              throw new Error("not exercised");
            },
            signChallenge: async () => ({ publicKey: "pub:companion", signature: "sig:companion" }),
            verifyEnvelope: async () => ({ valid: true }),
            verifySignature: async () => ({ valid: true }),
            verifyRequest: async () => ({ valid: true, verifiedAt: 1 }),
          },
        }),
      });
      expect(resolveCalls).toEqual(["@edwinpai/identity-core-linux-x64-gnu"]);
      expect(core).not.toBeNull();
      await expect(core?.getPublicKey()).resolves.toBe("pub:companion");
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("loads a staged native addon when a real identity-core.node is present", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "identity-core-native-staged-"));
    const modulePath = path.join(tempDir, "identity-core.node");

    await fs.writeFile(modulePath, "placeholder", "utf8");

    try {
      const core = loadNativeIdentityCore({
        envPath: undefined,
        bundledPath: undefined,
        stagedPath: modulePath,
        requireFn: () => ({
          default: {
            hasIdentity: async () => true,
            getIdentity: async () => ({ publicKey: "pub:staged", shortId: "id:staged" }),
            getPublicKey: async () => "pub:staged",
            derivePublicKey: async () => ({ publicKey: "derived:staged" }),
            signHttpRequest: async () => ({
              "x-bsv-identity-key": "key:staged",
              "x-bsv-signature": "sig:staged",
              "x-bsv-timestamp": "1",
              "x-bsv-nonce": "nonce:staged",
            }),
            signEnvelope: async () => {
              throw new Error("not exercised");
            },
            signChallenge: async () => ({ publicKey: "pub:staged", signature: "sig:staged" }),
            verifyEnvelope: async () => ({ valid: true }),
            verifySignature: async () => ({ valid: true }),
            verifyRequest: async () => ({ valid: true, verifiedAt: 1 }),
          },
        }),
      });
      expect(core).not.toBeNull();
      await expect(core?.getPublicKey()).resolves.toBe("pub:staged");
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("returns null for invalid native modules", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "identity-core-native-invalid-"));
    const modulePath = path.join(tempDir, "identity-core-invalid.cjs");

    await fs.writeFile(modulePath, `module.exports = { nope: true };`, "utf8");

    try {
      expect(loadNativeIdentityCore({ envPath: modulePath })).toBeNull();
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("loads when a sibling artifact manifest's SHA-256 matches the candidate", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "identity-core-native-manifest-ok-"));
    const fileName = "identity-core.cjs";
    const modulePath = path.join(tempDir, fileName);
    const moduleSource = `module.exports = {
      getIdentity: async () => ({ publicKey: "pub:manifest-ok" }),
      getPublicKey: async () => "pub:manifest-ok",
      hasIdentity: async () => true,
      derivePublicKey: async () => ({ publicKey: "derived" }),
      signHttpRequest: async () => ({
        "x-bsv-identity-key": "k",
        "x-bsv-signature": "s",
        "x-bsv-timestamp": "1",
        "x-bsv-nonce": "n",
      }),
      signEnvelope: async () => ({ payload: "p", envelope: { kid:"k", alg:"a", iat:0, exp:0, nonce:"n", payloadHash:"h", sig:"s", pubKey:"k" } }),
      signChallenge: async () => ({ publicKey: "k", signature: "s" }),
      verifyEnvelope: async () => ({ valid: true }),
      verifySignature: async () => ({ valid: true }),
      verifyRequest: async () => ({ valid: true, verifiedAt: 0 }),
    };`;

    await fs.writeFile(modulePath, moduleSource, "utf8");
    const sha256 = createHash("sha256").update(moduleSource, "utf8").digest("hex");
    await fs.writeFile(
      path.join(tempDir, "identity-core-artifact.json"),
      JSON.stringify({ target: "test", runner: "test", file: fileName, sha256 }, null, 2),
      "utf8",
    );

    try {
      const core = loadNativeIdentityCore({ envPath: modulePath });
      expect(core).not.toBeNull();
      await expect(core?.getPublicKey()).resolves.toBe("pub:manifest-ok");
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("returns null when the sibling manifest's SHA-256 does not match", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "identity-core-native-manifest-bad-"));
    const fileName = "identity-core.cjs";
    const modulePath = path.join(tempDir, fileName);

    await fs.writeFile(modulePath, `module.exports = { tampered: true };`, "utf8");
    await fs.writeFile(
      path.join(tempDir, "identity-core-artifact.json"),
      JSON.stringify(
        {
          target: "test",
          runner: "test",
          file: fileName,
          sha256: "0000000000000000000000000000000000000000000000000000000000000000",
        },
        null,
        2,
      ),
      "utf8",
    );

    try {
      expect(loadNativeIdentityCore({ envPath: modulePath })).toBeNull();
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("returns null when the sibling manifest is malformed", async () => {
    const tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "identity-core-native-manifest-malformed-"),
    );
    const fileName = "identity-core.cjs";
    const modulePath = path.join(tempDir, fileName);

    await fs.writeFile(modulePath, `module.exports = { nope: true };`, "utf8");
    await fs.writeFile(path.join(tempDir, "identity-core-artifact.json"), "{ not json", "utf8");

    try {
      expect(loadNativeIdentityCore({ envPath: modulePath })).toBeNull();
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("ignores manifest when its file field names a different sibling artifact", async () => {
    // The sync workflow may stage both the raw shared library AND a renamed
    // identity-core.node alongside one manifest that describes the shared
    // library. The loader should not block loading identity-core.node just
    // because the manifest is about a different file in the same directory.
    const tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "identity-core-native-manifest-other-"),
    );
    const fileName = "identity-core.cjs";
    const modulePath = path.join(tempDir, fileName);
    const moduleSource = `module.exports = {
      getIdentity: async () => ({ publicKey: "pub:other" }),
      getPublicKey: async () => "pub:other",
      hasIdentity: async () => true,
      derivePublicKey: async () => ({ publicKey: "derived" }),
      signHttpRequest: async () => ({
        "x-bsv-identity-key": "k",
        "x-bsv-signature": "s",
        "x-bsv-timestamp": "1",
        "x-bsv-nonce": "n",
      }),
      signEnvelope: async () => ({ payload: "p", envelope: { kid:"k", alg:"a", iat:0, exp:0, nonce:"n", payloadHash:"h", sig:"s", pubKey:"k" } }),
      signChallenge: async () => ({ publicKey: "k", signature: "s" }),
      verifyEnvelope: async () => ({ valid: true }),
      verifySignature: async () => ({ valid: true }),
      verifyRequest: async () => ({ valid: true, verifiedAt: 0 }),
    };`;

    await fs.writeFile(modulePath, moduleSource, "utf8");
    await fs.writeFile(
      path.join(tempDir, "identity-core-artifact.json"),
      JSON.stringify(
        {
          target: "test",
          runner: "test",
          file: "libidentity_core.dylib",
          sha256: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
        },
        null,
        2,
      ),
      "utf8",
    );

    try {
      const core = loadNativeIdentityCore({ envPath: modulePath });
      expect(core).not.toBeNull();
      await expect(core?.getPublicKey()).resolves.toBe("pub:other");
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});

describe("identity-core native loader helpers", () => {
  it("maps runtime triples to exact companion package names", () => {
    expect(getIdentityCoreNativeRuntimeTriple("linux", "x64")).toBe("linux-x64");
    expect(getIdentityCoreCompanionPackageName("linux-x64")).toBe(
      "@edwinpai/identity-core-linux-x64-gnu",
    );
    expect(getIdentityCoreCompanionPackageName("win32-x64")).toBe(
      "@edwinpai/identity-core-win32-x64-msvc",
    );
    expect(getIdentityCoreCompanionPackageName("unsupported")).toBeNull();
  });
});
