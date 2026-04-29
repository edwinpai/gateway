import type { ChallengeSignature, IdentityInfo } from "./types.js";
import { createIdentityCoreFromBinding } from "./binding.js";

export interface DesktopIdentityCoreTransport {
  getIdentity(): Promise<{
    public_key: string;
    petname: string;
    avatar_svg: string;
    short_id: string;
  }>;
  signChallenge(challenge: string): Promise<{
    publicKey: string;
    signature: string;
    shortId: string;
  }>;
}

export function createDesktopIdentityCoreBinding(transport: DesktopIdentityCoreTransport) {
  return createIdentityCoreFromBinding({
    async getIdentity(): Promise<IdentityInfo> {
      const identity = await transport.getIdentity();
      return {
        publicKey: identity.public_key,
        petname: identity.petname,
        avatarSvg: identity.avatar_svg,
        shortId: identity.short_id,
      };
    },

    async signChallenge(challenge: string): Promise<ChallengeSignature> {
      const signed = await transport.signChallenge(challenge);
      return {
        publicKey: signed.publicKey,
        signature: signed.signature,
        shortId: signed.shortId,
      };
    },
  });
}
