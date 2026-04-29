import { beforeEach, describe, expect, it, vi } from "vitest";

const readFileSync = vi.fn();
const loadConfig = vi.fn();
const resolveGatewayPort = vi.fn();
const signer = {
  getIdentityKey: vi.fn(() => "02abcdef"),
  signRequest: vi.fn(() => ({
    "x-bsv-identity-key": "02abcdef",
    "x-bsv-signature": "deadbeef",
    "x-bsv-timestamp": "123",
    "x-bsv-nonce": "nonce-1",
  })),
};
const fromHex = vi.fn(() => signer);
const loadNativeIdentityCore = vi.fn(() => null);

vi.mock("node:fs", () => ({
  readFileSync,
}));

vi.mock("../config/config.js", () => ({
  loadConfig,
  resolveGatewayPort,
}));

vi.mock("../auth/request-signer.js", () => ({
  RequestSigner: {
    fromHex,
  },
}));

vi.mock("@edwinpai/identity-core", () => ({
  loadNativeIdentityCore,
}));

describe("gateway-http-client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readFileSync.mockReturnValue("deadbeef\n");
    loadConfig.mockReturnValue({ gateway: { auth: { token: "test-token" } } });
    resolveGatewayPort.mockReturnValue(18789);
    loadNativeIdentityCore.mockReturnValue(null);
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    })) as typeof fetch;
  });

  it("signs gateway HTTP requests through the identity-core boundary using TS fallback", async () => {
    vi.resetModules();
    const { gatewayHttpFetch } = await import("./gateway-http-client.js");

    await expect(gatewayHttpFetch("/v1/test", "POST", { hello: "world" })).resolves.toEqual({
      ok: true,
      status: 200,
      data: { ok: true },
    });

    expect(fromHex).toHaveBeenCalledWith("deadbeef");
    expect(signer.signRequest).toHaveBeenCalledWith({
      method: "POST",
      path: "/v1/test",
      body: { hello: "world" },
      timestamp: undefined,
      nonce: undefined,
    });
    expect(global.fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:18789/v1/test",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ hello: "world" }),
        headers: expect.objectContaining({
          Authorization: "Bearer test-token",
          "x-bsv-identity-key": "02abcdef",
          "x-bsv-signature": "deadbeef",
        }),
      }),
    );
  });

  it("prefers loadNativeIdentityCore() when a native artifact is available", async () => {
    vi.resetModules();
    const nativeSignHttpRequest = vi.fn(async () => ({
      "x-bsv-identity-key": "02nativenative",
      "x-bsv-signature": "nativesig",
      "x-bsv-timestamp": "456",
      "x-bsv-nonce": "native-nonce",
    }));
    loadNativeIdentityCore.mockReturnValue({
      hasIdentity: async () => true,
      getIdentity: async () => ({ publicKey: "02nativenative" }),
      getPublicKey: async () => "02nativenative",
      derivePublicKey: async () => ({ publicKey: "02nativenative" }),
      signHttpRequest: nativeSignHttpRequest,
      signEnvelope: async () => {
        throw new Error("not exercised");
      },
      signChallenge: async () => ({
        publicKey: "02nativenative",
        signature: "sig",
      }),
      verifyEnvelope: async () => ({ valid: true }),
      verifySignature: async () => ({ valid: true }),
      verifyRequest: async () => ({ valid: true, verifiedAt: 0 }),
    });

    const { gatewayHttpFetch } = await import("./gateway-http-client.js");

    await expect(gatewayHttpFetch("/v1/test", "POST", { hello: "world" })).resolves.toEqual({
      ok: true,
      status: 200,
      data: { ok: true },
    });

    expect(loadNativeIdentityCore).toHaveBeenCalledOnce();
    expect(nativeSignHttpRequest).toHaveBeenCalledWith({
      method: "POST",
      path: "/v1/test",
      body: { hello: "world" },
    });
    // TS-side fallback must NOT be touched when native is preferred.
    expect(fromHex).not.toHaveBeenCalled();
    expect(readFileSync).not.toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:18789/v1/test",
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-bsv-identity-key": "02nativenative",
          "x-bsv-signature": "nativesig",
        }),
      }),
    );
  });
});
