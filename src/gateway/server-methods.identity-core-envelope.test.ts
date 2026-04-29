import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SignedEnvelope } from "../../packages/identity-core/src/types.js";

const identityCoreVerifyEnvelope = vi.fn();

vi.mock("../../packages/identity-core/src/node-binding.js", () => ({
  createNodeIdentityCoreBinding: vi.fn(() => ({
    verifyEnvelope: identityCoreVerifyEnvelope,
  })),
}));

describe("handleGatewayRequest signed envelope verification", () => {
  beforeEach(() => {
    identityCoreVerifyEnvelope.mockReset();
  });

  it("routes signed envelope verification through identity-core before dispatching", async () => {
    identityCoreVerifyEnvelope.mockResolvedValue({
      valid: true,
      pubKey: "02abcdef",
      kid: "deadbeef",
    });

    const { handleGatewayRequest } = await import("./server-methods.js");
    const handler = vi.fn();
    const respond = vi.fn();
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

    await handleGatewayRequest({
      req: {
        method: "send",
        params: {
          text: "hello",
          signedEnvelope: envelope,
        },
      } as any,
      client: {
        connect: {
          role: "operator",
          scopes: ["operator.write"],
        },
      } as any,
      isWebchatConnect: () => false,
      respond,
      context: {
        getConfig: () => ({
          security: {
            requireSignedRequests: true,
            authorizedKeys: [envelope.pubKey],
          },
          gateway: { bsvAuth: { enabled: true } },
        }),
      } as any,
      extraHandlers: {
        send: handler,
      },
    });

    expect(identityCoreVerifyEnvelope).toHaveBeenCalledWith(envelope, {
      authorizedKeys: [envelope.pubKey],
    });
    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0]?.[0]).toMatchObject({
      verifiedSignerKey: envelope.pubKey,
      verifiedEnvelope: envelope,
      params: { text: "hello" },
    });
    expect(respond).not.toHaveBeenCalled();
  });
});
