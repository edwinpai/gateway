import { describe, expect, it, vi } from "vitest";
import type {
  SignMessageInput,
  SignedEnvelope,
  SignedMessage,
  VerifyRequestInput,
  VerifySignatureInput,
  VerifySignatureResult,
} from "../packages/identity-core/src/types.js";
import { createNodeIdentityCoreBinding } from "../packages/identity-core/src/node-binding.js";

describe("node identity-core binding adapter", () => {
  it("uses getPublicKey as a fallback for getIdentity", async () => {
    const core = createNodeIdentityCoreBinding({
      getPublicKey: vi.fn(async () => "02abcdef"),
      signHttpRequest: vi.fn(async () => ({
        "x-bsv-identity-key": "02abcdef",
        "x-bsv-signature": "deadbeef",
        "x-bsv-timestamp": "123",
        "x-bsv-nonce": "nonce-1",
      })),
    });

    await expect(core.getIdentity()).resolves.toEqual({
      publicKey: "02abcdef",
    });
  });

  it("passes through signHttpRequest", async () => {
    const transport = {
      getPublicKey: vi.fn(async () => "02abcdef"),
      signHttpRequest: vi.fn(async () => ({
        "x-bsv-identity-key": "02abcdef",
        "x-bsv-signature": "deadbeef",
        "x-bsv-timestamp": "123",
        "x-bsv-nonce": "nonce-1",
      })),
    };

    const core = createNodeIdentityCoreBinding(transport);

    await expect(
      core.signHttpRequest({ method: "POST", path: "/v1/test", body: { ok: true } }),
    ).resolves.toEqual({
      "x-bsv-identity-key": "02abcdef",
      "x-bsv-signature": "deadbeef",
      "x-bsv-timestamp": "123",
      "x-bsv-nonce": "nonce-1",
    });
    expect(transport.signHttpRequest).toHaveBeenCalledWith({
      method: "POST",
      path: "/v1/test",
      body: { ok: true },
    });
  });

  it("passes through verifyEnvelope", async () => {
    const envelope: SignedEnvelope = {
      kid: "deadbeef",
      alg: "BSV-ECDSA",
      iat: 1,
      exp: 2,
      nonce: "nonce-1",
      payloadHash: "hash-1",
      sig: "sig-1",
      pubKey: "02abcdef",
    };
    const transport = {
      getPublicKey: vi.fn(async () => "02abcdef"),
      signHttpRequest: vi.fn(async () => ({
        "x-bsv-identity-key": "02abcdef",
        "x-bsv-signature": "deadbeef",
        "x-bsv-timestamp": "123",
        "x-bsv-nonce": "nonce-1",
      })),
      verifyEnvelope: vi.fn(async () => ({
        valid: true,
        pubKey: envelope.pubKey,
        kid: envelope.kid,
      })),
    };

    const core = createNodeIdentityCoreBinding(transport);

    await expect(
      core.verifyEnvelope(envelope, { expectedPayloadHash: envelope.payloadHash }),
    ).resolves.toEqual({ valid: true, pubKey: envelope.pubKey, kid: envelope.kid });
    expect(transport.verifyEnvelope).toHaveBeenCalledWith(envelope, {
      expectedPayloadHash: envelope.payloadHash,
    });
  });

  it("passes through signMessage", async () => {
    const input: SignMessageInput = {
      message: "hello",
    };
    const expected: SignedMessage = { signature: "deadbeef" };
    const transport = {
      getPublicKey: vi.fn(async () => "02abcdef"),
      signHttpRequest: vi.fn(async () => ({
        "x-bsv-identity-key": "02abcdef",
        "x-bsv-signature": "deadbeef",
        "x-bsv-timestamp": "123",
        "x-bsv-nonce": "nonce-1",
      })),
      signMessage: vi.fn(async () => expected),
    };

    const core = createNodeIdentityCoreBinding(transport);

    await expect(core.signMessage(input)).resolves.toEqual(expected);
    expect(transport.signMessage).toHaveBeenCalledWith(input);
  });

  it("passes through verifySignature", async () => {
    const input: VerifySignatureInput = {
      data: "hello",
      signature: "deadbeef",
      publicKey: "02abcdef",
    };
    const expected: VerifySignatureResult = { valid: true };
    const transport = {
      getPublicKey: vi.fn(async () => "02abcdef"),
      signHttpRequest: vi.fn(async () => ({
        "x-bsv-identity-key": "02abcdef",
        "x-bsv-signature": "deadbeef",
        "x-bsv-timestamp": "123",
        "x-bsv-nonce": "nonce-1",
      })),
      verifySignature: vi.fn(async () => expected),
    };

    const core = createNodeIdentityCoreBinding(transport);

    await expect(core.verifySignature(input)).resolves.toEqual(expected);
    expect(transport.verifySignature).toHaveBeenCalledWith(input);
  });

  it("passes through verifyRequest", async () => {
    const input: VerifyRequestInput = {
      method: "POST",
      path: "/v1/test",
      body: { ok: true },
      timestamp: 123,
      nonce: "nonce-1",
      identityKey: "02abcdef",
      signature: "deadbeef",
    };
    const expected = {
      valid: true,
      identity: {
        identityKey: input.identityKey,
        lastSeen: 123,
      },
      verifiedAt: 123,
    };
    const transport = {
      getPublicKey: vi.fn(async () => "02abcdef"),
      signHttpRequest: vi.fn(async () => ({
        "x-bsv-identity-key": "02abcdef",
        "x-bsv-signature": "deadbeef",
        "x-bsv-timestamp": "123",
        "x-bsv-nonce": "nonce-1",
      })),
      verifyRequest: vi.fn(async () => expected),
    };

    const core = createNodeIdentityCoreBinding(transport);

    await expect(core.verifyRequest(input, { maxTimestampAge: 30000 })).resolves.toEqual(expected);
    expect(transport.verifyRequest).toHaveBeenCalledWith(input, { maxTimestampAge: 30000 });
  });

  it("passes through signEnvelope", async () => {
    const envelope: SignedEnvelope = {
      kid: "deadbeef",
      alg: "BSV-ECDSA",
      iat: 100,
      exp: 130,
      nonce: "nonce-1",
      payloadHash: "hash-1",
      sig: "sig-1",
      pubKey: "02abcdef",
    };
    const transport = {
      getPublicKey: vi.fn(async () => "02abcdef"),
      signHttpRequest: vi.fn(async () => ({
        "x-bsv-identity-key": "02abcdef",
        "x-bsv-signature": "deadbeef",
        "x-bsv-timestamp": "123",
        "x-bsv-nonce": "nonce-1",
      })),
      signEnvelope: vi.fn(async (input: { payload: string }) => ({
        payload: input.payload,
        envelope,
      })),
    };

    const core = createNodeIdentityCoreBinding(transport);

    await expect(core.signEnvelope({ payload: "hello" })).resolves.toEqual({
      payload: "hello",
      envelope,
    });
    expect(transport.signEnvelope).toHaveBeenCalledWith({ payload: "hello" });
  });

  it("throws for operations the transport does not implement", async () => {
    const core = createNodeIdentityCoreBinding({
      getPublicKey: vi.fn(async () => "02abcdef"),
      signHttpRequest: vi.fn(async () => ({
        "x-bsv-identity-key": "02abcdef",
        "x-bsv-signature": "deadbeef",
        "x-bsv-timestamp": "123",
        "x-bsv-nonce": "nonce-1",
      })),
    });

    await expect(core.signChallenge("hello")).rejects.toThrow(
      "NodeIdentityCoreTransport does not implement signChallenge()",
    );
  });
});
