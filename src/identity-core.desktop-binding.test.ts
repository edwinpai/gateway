import { describe, expect, it, vi } from "vitest";
import { createDesktopIdentityCoreBinding } from "../packages/identity-core/src/desktop-binding.js";

describe("desktop identity-core binding adapter", () => {
  it("maps desktop getIdentity response into shared IdentityInfo", async () => {
    const transport = {
      getIdentity: vi.fn(async () => ({
        public_key: "02abcdef",
        petname: "Swift Falcon",
        avatar_svg: "<svg />",
        short_id: "edw:12345678",
      })),
      signChallenge: vi.fn(async () => ({
        publicKey: "02abcdef",
        signature: "deadbeef",
        shortId: "edw:12345678",
      })),
    };

    const core = createDesktopIdentityCoreBinding(transport);

    await expect(core.getIdentity()).resolves.toEqual({
      publicKey: "02abcdef",
      petname: "Swift Falcon",
      avatarSvg: "<svg />",
      shortId: "edw:12345678",
    });
  });

  it("passes signChallenge through the desktop transport", async () => {
    const transport = {
      getIdentity: vi.fn(async () => ({
        public_key: "02abcdef",
        petname: "Swift Falcon",
        avatar_svg: "<svg />",
        short_id: "edw:12345678",
      })),
      signChallenge: vi.fn(async (challenge: string) => ({
        publicKey: "02abcdef",
        signature: `sig:${challenge}`,
        shortId: "edw:12345678",
      })),
    };

    const core = createDesktopIdentityCoreBinding(transport);

    await expect(core.signChallenge("hello")).resolves.toEqual({
      publicKey: "02abcdef",
      signature: "sig:hello",
      shortId: "edw:12345678",
    });
    expect(transport.signChallenge).toHaveBeenCalledWith("hello");
  });
});
