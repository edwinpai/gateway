/**
 * Config Signature — BSV-authenticated config integrity
 *
 * Provides tamper detection for edwinpai.json by storing a BSV-signed attestation
 * alongside the config file. Every config mutation that passes BSV signature
 * verification writes an attestation to `edwinpai.json.sig`. On load, the
 * attestation is verified to ensure the config hasn't been tampered with.
 *
 * The attestation binds the config hash to a verified BSV identity, proving
 * that an authorized key holder approved the config state.
 */

import { createHash } from "node:crypto";
// Re-use the DER encoding + verify logic from signed-request-verify
// to avoid duplicating secp256k1 ASN.1 plumbing.
import { createVerify } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { SignedEnvelope } from "../gateway/signed-request-verify.js";

/**
 * Stored attestation proving an authorized key holder approved this config state.
 */
export interface ConfigAttestation {
  /** SHA-256 hex hash of the raw config file content at time of signing */
  configHash: string;
  /** Compressed secp256k1 public key (hex) of the signer */
  attestedBy: string;
  /** Timestamp (ms since epoch) when attestation was created */
  attestedAt: number;
  /** The original SignedEnvelope from the BSV-authenticated config mutation */
  envelope: SignedEnvelope;
}

export interface ConfigAttestationResult {
  valid: boolean;
  error?: string;
  attestedBy?: string;
  attestedAt?: number;
}

const SIG_EXTENSION = ".sig";

/**
 * Derive the `.sig` sidecar path for a given config path.
 */
export function resolveConfigSigPath(configPath: string): string {
  return configPath + SIG_EXTENSION;
}

/**
 * Compute SHA-256 hex hash of raw config content.
 */
export function hashConfigContent(raw: string): string {
  return createHash("sha256").update(raw, "utf-8").digest("hex");
}

/**
 * Write a config attestation sidecar file after a BSV-authenticated config mutation.
 *
 * @param configPath - Path to the config file (e.g. ~/.edwinpai/edwinpai.json)
 * @param signerPubKey - Compressed secp256k1 public key (hex) from the verified envelope
 * @param envelope - The original SignedEnvelope that authorized the mutation
 */
export async function writeConfigAttestation(
  configPath: string,
  signerPubKey: string,
  envelope: SignedEnvelope,
): Promise<void> {
  const raw = fs.readFileSync(configPath, "utf-8");
  const configHash = hashConfigContent(raw);

  const attestation: ConfigAttestation = {
    configHash,
    attestedBy: signerPubKey,
    attestedAt: Date.now(),
    envelope,
  };

  const sigPath = resolveConfigSigPath(configPath);
  const tmpPath = sigPath + ".tmp";

  fs.writeFileSync(tmpPath, JSON.stringify(attestation, null, 2), { mode: 0o600 });
  fs.renameSync(tmpPath, sigPath);
}

/**
 * Read a config attestation sidecar file.
 *
 * @returns The parsed attestation, or null if the file doesn't exist or is malformed.
 */
export function readConfigAttestation(configPath: string): ConfigAttestation | null {
  const sigPath = resolveConfigSigPath(configPath);
  try {
    if (!fs.existsSync(sigPath)) {
      return null;
    }
    const raw = fs.readFileSync(sigPath, "utf-8");
    const parsed = JSON.parse(raw) as ConfigAttestation;

    // Basic shape validation
    if (
      typeof parsed.configHash !== "string" ||
      typeof parsed.attestedBy !== "string" ||
      typeof parsed.attestedAt !== "number" ||
      !parsed.envelope ||
      typeof parsed.envelope.sig !== "string"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Encode a compressed secp256k1 public key in DER SPKI format.
 * (Duplicated from signed-request-verify to avoid circular import.)
 */
function encodeSecp256k1PublicKeyDer(compressedKey: Buffer): Buffer {
  const ecOid = Buffer.from("06072a8648ce3d0201", "hex");
  const secp256k1Oid = Buffer.from("06052b8104000a", "hex");
  const algIdContent = Buffer.concat([ecOid, secp256k1Oid]);
  const algId = Buffer.concat([Buffer.from([0x30, algIdContent.length]), algIdContent]);
  const bitString = Buffer.concat([
    Buffer.from([0x03, compressedKey.length + 1, 0x00]),
    compressedKey,
  ]);
  const spkiContent = Buffer.concat([algId, bitString]);
  return Buffer.concat([Buffer.from([0x30, spkiContent.length]), spkiContent]);
}

/**
 * Verify the ECDSA signature in a stored envelope WITHOUT freshness/nonce checks.
 * Used for attestation verification where the envelope was already validated at write time.
 */
function verifyEnvelopeSignatureOnly(envelope: SignedEnvelope): boolean {
  try {
    const signingData = `${envelope.kid}|${envelope.iat}|${envelope.exp}|${envelope.nonce}|${envelope.payloadHash}`;
    const sigBuffer = Buffer.from(envelope.sig, "hex");
    const pubKeyBytes = Buffer.from(envelope.pubKey, "hex");

    // Verify key fingerprint
    const kidHash = createHash("sha256").update(pubKeyBytes).digest("hex").slice(0, 8);
    if (kidHash !== envelope.kid) {
      return false;
    }

    const verify = createVerify("SHA256");
    verify.update(signingData);
    const derPubKey = encodeSecp256k1PublicKeyDer(pubKeyBytes);
    return verify.verify({ key: derPubKey, format: "der", type: "spki" }, sigBuffer);
  } catch {
    return false;
  }
}

/**
 * Verify config integrity against the attestation sidecar.
 *
 * Checks:
 * 1. Attestation file exists and is well-formed
 * 2. Config file hash matches the attested hash (tamper detection)
 * 3. Envelope signature is cryptographically valid
 * 4. Signer's public key is in the authorized keys list
 *
 * @param configPath - Path to the config file
 * @param authorizedKeys - Array of authorized public keys (hex)
 * @returns Verification result
 */
export function verifyConfigIntegrity(
  configPath: string,
  authorizedKeys: string[],
): ConfigAttestationResult {
  const attestation = readConfigAttestation(configPath);
  if (!attestation) {
    return { valid: false, error: "config attestation missing or malformed" };
  }

  // 1. Hash the current config and compare
  let raw: string;
  try {
    raw = fs.readFileSync(configPath, "utf-8");
  } catch {
    return { valid: false, error: "cannot read config file" };
  }
  const currentHash = hashConfigContent(raw);
  if (currentHash !== attestation.configHash) {
    return {
      valid: false,
      error: "config file has been modified since last authorized write (hash mismatch)",
    };
  }

  // 2. Verify the envelope signature (without freshness checks)
  if (!verifyEnvelopeSignatureOnly(attestation.envelope)) {
    return { valid: false, error: "attestation envelope signature is invalid" };
  }

  // 3. Verify pubKey consistency
  if (attestation.envelope.pubKey !== attestation.attestedBy) {
    return { valid: false, error: "attestation pubKey mismatch" };
  }

  // 4. Check signer is authorized
  if (authorizedKeys.length > 0 && !authorizedKeys.includes(attestation.attestedBy)) {
    return { valid: false, error: "config was signed by an unauthorized key" };
  }

  return {
    valid: true,
    attestedBy: attestation.attestedBy,
    attestedAt: attestation.attestedAt,
  };
}
