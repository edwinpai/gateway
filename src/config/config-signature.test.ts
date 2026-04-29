import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SignedEnvelope } from "../gateway/signed-request-verify.js";
import {
  hashConfigContent,
  readConfigAttestation,
  resolveConfigSigPath,
  verifyConfigIntegrity,
  writeConfigAttestation,
} from "./config-signature.js";

/**
 * Generate a deterministic secp256k1 key pair for testing.
 * Returns compressed public key (hex) and a sign function.
 */
function generateTestKeyPair() {
  const keyPair = crypto.generateKeyPairSync("ec", {
    namedCurve: "secp256k1",
  });
  const rawPub = keyPair.publicKey.export({ type: "spki", format: "der" });
  // Extract the compressed public key from DER SPKI
  // SPKI = SEQUENCE { AlgorithmIdentifier, BIT STRING { pubkey } }
  // For secp256k1 compressed: last 33 bytes after the BIT STRING wrapper
  const uncompressedKey = rawPub.subarray(rawPub.length - 65); // 04 + 32x + 32y
  const x = uncompressedKey.subarray(1, 33);
  const yLast = uncompressedKey[64]!;
  const prefix = yLast % 2 === 0 ? 0x02 : 0x03;
  const compressed = Buffer.concat([Buffer.from([prefix]), x]);
  const pubKeyHex = compressed.toString("hex");

  const sign = (data: string): string => {
    const signer = crypto.createSign("SHA256");
    signer.update(data);
    return signer.sign(keyPair.privateKey).toString("hex");
  };

  return { pubKeyHex, sign };
}

function createTestEnvelope(
  pubKeyHex: string,
  sign: (data: string) => string,
  payloadHash?: string,
): SignedEnvelope {
  const kid = crypto
    .createHash("sha256")
    .update(Buffer.from(pubKeyHex, "hex"))
    .digest("hex")
    .slice(0, 8);
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 30;
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const hash = payloadHash ?? crypto.randomBytes(32).toString("hex");
  const signingData = `${kid}|${iat}|${exp}|${nonce}|${hash}`;
  const sig = sign(signingData);

  return {
    kid,
    alg: "BSV-ECDSA",
    iat,
    exp,
    nonce,
    payloadHash: hash,
    sig,
    pubKey: pubKeyHex,
  };
}

describe("config-signature", () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "edwinpai-config-sig-test-"));
    configPath = path.join(tmpDir, "edwinpai.json");
    fs.writeFileSync(configPath, JSON.stringify({ security: { authorizedKeys: [] } }, null, 2));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("resolveConfigSigPath", () => {
    it("appends .sig to config path", () => {
      expect(resolveConfigSigPath("/home/user/.edwinpai/edwinpai.json")).toBe(
        "/home/user/.edwinpai/edwinpai.json.sig",
      );
    });
  });

  describe("hashConfigContent", () => {
    it("produces consistent SHA-256 hex", () => {
      const content = '{"test": true}';
      const hash = hashConfigContent(content);
      expect(hash).toHaveLength(64);
      expect(hash).toBe(hashConfigContent(content));
    });

    it("produces different hashes for different content", () => {
      expect(hashConfigContent("a")).not.toBe(hashConfigContent("b"));
    });
  });

  describe("writeConfigAttestation / readConfigAttestation", () => {
    it("writes and reads a valid attestation", async () => {
      const { pubKeyHex, sign } = generateTestKeyPair();
      const envelope = createTestEnvelope(pubKeyHex, sign);

      await writeConfigAttestation(configPath, pubKeyHex, envelope);

      const attestation = readConfigAttestation(configPath);
      expect(attestation).not.toBeNull();
      expect(attestation!.attestedBy).toBe(pubKeyHex);
      expect(attestation!.configHash).toBe(hashConfigContent(fs.readFileSync(configPath, "utf-8")));
      expect(attestation!.envelope.sig).toBe(envelope.sig);
    });

    it("returns null for missing sig file", () => {
      expect(readConfigAttestation(configPath)).toBeNull();
    });

    it("returns null for malformed sig file", () => {
      fs.writeFileSync(configPath + ".sig", "not json");
      expect(readConfigAttestation(configPath)).toBeNull();
    });

    it("returns null for sig file with missing fields", () => {
      fs.writeFileSync(configPath + ".sig", JSON.stringify({ configHash: "abc" }));
      expect(readConfigAttestation(configPath)).toBeNull();
    });
  });

  describe("verifyConfigIntegrity", () => {
    it("passes for valid attestation with authorized key", async () => {
      const { pubKeyHex, sign } = generateTestKeyPair();
      const envelope = createTestEnvelope(pubKeyHex, sign);

      await writeConfigAttestation(configPath, pubKeyHex, envelope);

      const result = verifyConfigIntegrity(configPath, [pubKeyHex]);
      expect(result.valid).toBe(true);
      expect(result.attestedBy).toBe(pubKeyHex);
    });

    it("passes when authorizedKeys is empty (open mode)", async () => {
      const { pubKeyHex, sign } = generateTestKeyPair();
      const envelope = createTestEnvelope(pubKeyHex, sign);

      await writeConfigAttestation(configPath, pubKeyHex, envelope);

      const result = verifyConfigIntegrity(configPath, []);
      expect(result.valid).toBe(true);
    });

    it("fails when config file was tampered with", async () => {
      const { pubKeyHex, sign } = generateTestKeyPair();
      const envelope = createTestEnvelope(pubKeyHex, sign);

      await writeConfigAttestation(configPath, pubKeyHex, envelope);

      // Tamper with the config
      fs.writeFileSync(configPath, '{"tampered": true}');

      const result = verifyConfigIntegrity(configPath, [pubKeyHex]);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("hash mismatch");
    });

    it("fails when signer is not in authorized keys", async () => {
      const { pubKeyHex, sign } = generateTestKeyPair();
      const { pubKeyHex: otherKey } = generateTestKeyPair();
      const envelope = createTestEnvelope(pubKeyHex, sign);

      await writeConfigAttestation(configPath, pubKeyHex, envelope);

      const result = verifyConfigIntegrity(configPath, [otherKey]);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("unauthorized key");
    });

    it("fails when attestation is missing", () => {
      const result = verifyConfigIntegrity(configPath, []);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("missing");
    });

    it("fails when envelope signature is invalid", async () => {
      const { pubKeyHex } = generateTestKeyPair();
      const envelope: SignedEnvelope = {
        kid: crypto
          .createHash("sha256")
          .update(Buffer.from(pubKeyHex, "hex"))
          .digest("hex")
          .slice(0, 8),
        alg: "BSV-ECDSA",
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 30,
        nonce: "deadbeef",
        payloadHash: "abc123",
        sig: "deadbeef", // invalid signature
        pubKey: pubKeyHex,
      };

      await writeConfigAttestation(configPath, pubKeyHex, envelope);

      const result = verifyConfigIntegrity(configPath, [pubKeyHex]);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("signature is invalid");
    });

    it("fails when pubKey in attestation doesn't match envelope", async () => {
      const { pubKeyHex, sign } = generateTestKeyPair();
      const { pubKeyHex: otherKey } = generateTestKeyPair();
      const envelope = createTestEnvelope(pubKeyHex, sign);

      // Write attestation with mismatched attestedBy
      await writeConfigAttestation(configPath, otherKey, envelope);

      const result = verifyConfigIntegrity(configPath, [otherKey]);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("pubKey mismatch");
    });
  });
});
