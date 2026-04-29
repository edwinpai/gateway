import { createHash, randomBytes } from "node:crypto";
import type { SignedEnvelope } from "../gateway/signed-request-verify.js";
import { SecurePrivateKey } from "../crypto/bsv-sdk-wrapper.js";

function sha256Hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export function createSignedEnvelope(payload: string, privateKeyHex: string): SignedEnvelope {
  const payloadHash = sha256Hex(payload);
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 30;
  const nonce = randomBytes(16).toString("hex");

  const privateKey = SecurePrivateKey.fromHex(privateKeyHex);
  const pubKey = privateKey.toPublicKey().toHex();
  const kid = sha256Hex(Buffer.from(pubKey, "hex")).slice(0, 8);

  const signingData = `${kid}|${now}|${exp}|${nonce}|${payloadHash}`;
  const signingHash = sha256Hex(signingData);
  const sig = privateKey.sign(signingHash).toString("hex");

  return {
    kid,
    alg: "BSV-ECDSA",
    iat: now,
    exp,
    nonce,
    payloadHash,
    sig,
    pubKey,
  };
}
