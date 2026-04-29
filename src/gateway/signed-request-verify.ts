/**
 * Signed Request Verification - BSV identity signature verification
 *
 * Verifies SignedEnvelope from EdwinPAI Desktop to ensure:
 * 1. Request was signed by a known authorized identity
 * 2. Signature is valid (BSV-ECDSA on secp256k1)
 * 3. Request hasn't expired (30-second window)
 * 4. Nonce prevents replay attacks
 *
 * Gateway config key: security.requireSignedRequests
 * When enabled, sensitive methods require valid signatures.
 */

import { createHash, createVerify } from "crypto";
import type { SignedEnvelope, VerifyResult } from "../../packages/identity-core/src/types.js";
import { createNodeIdentityCoreBinding } from "../../packages/identity-core/src/node-binding.js";

/** Methods that require BSV-signed requests when enforcement is on */
export const SIGNATURE_REQUIRED_METHODS = new Set([
  // Config mutation
  "config.patch",
  "config.apply",
  "config.set",

  // Channel/session side effects
  "channels.logout",
  "send",
  "agent",
  "system-event",
  "wake",
  "set-heartbeats",

  // Sessions (persistent state)
  "sessions.patch",
  "sessions.reset",
  "sessions.delete",
  "sessions.compact",

  // Cron
  "cron.add",
  "cron.update",
  "cron.remove",
  "cron.run",

  // Device & node authorization / control
  "node.pair.request",
  "node.pair.approve",
  "node.pair.reject",
  "node.pair.verify",
  "device.pair.approve",
  "device.pair.reject",
  "device.token.rotate",
  "device.token.revoke",
  "node.rename",
  "node.invoke",

  // Exec approvals
  "exec.approvals.set",
  "exec.approvals.node.set",
  // Note: exec.approval.resolve is intentionally NOT here.
  // The Desktop app resolves approvals via token-authenticated WS with operator.approvals scope.
  // Requiring BSV signature on resolve would block the approval flow since the Desktop UI's
  // gateway calls don't currently sign requests. The approval decision IS the user authorization.

  // Settings toggles
  "voicewake.set",
  "tts.enable",
  "tts.disable",
  "tts.setProvider",

  // Skills / updates
  "skills.install",
  "skills.update",
  "update.run",

  // Browser automation requests (external side effects)
  "browser.request",
]);

/** Recent nonces for replay prevention (TTL = 60 seconds) */
const recentNonces = new Map<string, number>();

// Clean old nonces every 60 seconds
setInterval(() => {
  const cutoff = Date.now() / 1000 - 60;
  for (const [nonce, iat] of recentNonces) {
    if (iat < cutoff) {
      recentNonces.delete(nonce);
    }
  }
}, 60_000);

export type { SignedEnvelope, VerifyResult };

interface VerifySignedEnvelopeOptions {
  expectedPayloadHash?: string;
  authorizedKeys?: Set<string>;
  nowSeconds?: number;
}

let gatewayEnvelopeIdentityCore: ReturnType<typeof createNodeIdentityCoreBinding> | null = null;

export function getGatewayEnvelopeIdentityCore(): ReturnType<typeof createNodeIdentityCoreBinding> {
  if (gatewayEnvelopeIdentityCore) {
    return gatewayEnvelopeIdentityCore;
  }

  gatewayEnvelopeIdentityCore = createNodeIdentityCoreBinding({
    async getPublicKey(): Promise<string> {
      throw new Error("GatewayEnvelopeIdentityCore does not implement getPublicKey()");
    },
    async signHttpRequest(): Promise<never> {
      throw new Error("GatewayEnvelopeIdentityCore does not implement signHttpRequest()");
    },
    async verifyEnvelope(envelope, options): Promise<VerifyResult> {
      return verifySignedEnvelopeWithOptions(envelope, {
        expectedPayloadHash: options?.expectedPayloadHash,
        authorizedKeys: options?.authorizedKeys ? new Set(options.authorizedKeys) : undefined,
        nowSeconds: options?.nowSeconds,
      });
    },
  });

  return gatewayEnvelopeIdentityCore;
}

/**
 * Verify a signed envelope
 *
 * @param envelope - The signed envelope from Desktop
 * @param expectedPayloadHash - SHA-256 of the actual request payload (optional cross-check)
 * @param authorizedKeys - Set of authorized public keys (if empty, any valid sig accepted)
 */
export function verifySignedEnvelope(
  envelope: SignedEnvelope,
  expectedPayloadHash?: string,
  authorizedKeys?: Set<string>,
): VerifyResult {
  return verifySignedEnvelopeWithOptions(envelope, {
    expectedPayloadHash,
    authorizedKeys,
  });
}

function verifySignedEnvelopeWithOptions(
  envelope: SignedEnvelope,
  options: VerifySignedEnvelopeOptions = {},
): VerifyResult {
  const { expectedPayloadHash, authorizedKeys, nowSeconds } = options;

  try {
    // 1. Check algorithm
    if (envelope.alg !== "BSV-ECDSA") {
      return { valid: false, error: `unsupported algorithm: ${envelope.alg}` };
    }

    // 2. Check expiry
    const now = nowSeconds ?? Math.floor(Date.now() / 1000);
    if (now > envelope.exp) {
      return { valid: false, error: "signature expired" };
    }
    if (envelope.iat > now + 5) {
      return { valid: false, error: "signature issued in the future" };
    }

    // 3. Check nonce (replay prevention)
    if (recentNonces.has(envelope.nonce)) {
      return { valid: false, error: "nonce already used (replay detected)" };
    }

    // 4. Cross-check payload hash if provided
    if (expectedPayloadHash && envelope.payloadHash !== expectedPayloadHash) {
      return { valid: false, error: "payload hash mismatch" };
    }

    // 5. Verify key fingerprint matches pubKey
    const pubKeyBytes = Buffer.from(envelope.pubKey, "hex");
    const kidHash = createHash("sha256").update(pubKeyBytes).digest("hex").slice(0, 8);
    if (kidHash !== envelope.kid) {
      return { valid: false, error: "key fingerprint mismatch" };
    }

    // 6. Check authorized keys (if enforcement list provided)
    if (authorizedKeys && authorizedKeys.size > 0 && !authorizedKeys.has(envelope.pubKey)) {
      return { valid: false, error: "public key not in authorized list" };
    }

    // 7. Verify ECDSA signature
    const signingData = `${envelope.kid}|${envelope.iat}|${envelope.exp}|${envelope.nonce}|${envelope.payloadHash}`;
    const sigBuffer = Buffer.from(envelope.sig, "hex");

    // Node.js crypto verify with secp256k1
    const verify = createVerify("SHA256");
    verify.update(signingData);

    // Convert compressed pubkey to DER format for Node.js
    // secp256k1 compressed key: 33 bytes (02/03 prefix)
    const derPubKey = encodeSecp256k1PublicKeyDer(pubKeyBytes);
    const isValid = verify.verify({ key: derPubKey, format: "der", type: "spki" }, sigBuffer);

    if (!isValid) {
      return { valid: false, error: "invalid signature" };
    }

    // 8. Record nonce to prevent replay
    recentNonces.set(envelope.nonce, envelope.iat);

    return { valid: true, pubKey: envelope.pubKey, kid: envelope.kid };
  } catch (err) {
    return { valid: false, error: `verification error: ${(err as Error).message}` };
  }
}

/**
 * Check if a method requires signature verification
 */
export function methodRequiresSignature(method: string): boolean {
  return SIGNATURE_REQUIRED_METHODS.has(method);
}

/**
 * Encode a compressed secp256k1 public key in DER SPKI format
 * for use with Node.js crypto.createVerify
 */
function encodeSecp256k1PublicKeyDer(compressedKey: Buffer): Buffer {
  // ASN.1 DER header for secp256k1 SPKI with compressed key
  // SEQUENCE { SEQUENCE { OID ecPublicKey, OID secp256k1 }, BIT STRING { compressedKey } }
  const ecOid = Buffer.from("06072a8648ce3d0201", "hex"); // OID 1.2.840.10045.2.1 (ecPublicKey)
  const secp256k1Oid = Buffer.from("06052b8104000a", "hex"); // OID 1.3.132.0.10 (secp256k1)

  // AlgorithmIdentifier SEQUENCE
  const algIdContent = Buffer.concat([ecOid, secp256k1Oid]);
  const algId = Buffer.concat([Buffer.from([0x30, algIdContent.length]), algIdContent]);

  // BIT STRING wrapping the public key (0x00 = no unused bits)
  const bitString = Buffer.concat([
    Buffer.from([0x03, compressedKey.length + 1, 0x00]),
    compressedKey,
  ]);

  // Outer SEQUENCE
  const spkiContent = Buffer.concat([algId, bitString]);
  const spki = Buffer.concat([Buffer.from([0x30, spkiContent.length]), spkiContent]);

  return spki;
}
