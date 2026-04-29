import type {
  ChallengeSignature,
  IdentityCore,
  IdentityInfo,
  SignedEnvelope,
  SignedMessage,
  SignedPayload,
  SignedRequestHeaders,
  VerifyResult,
  VerifySignatureResult,
  DeriveKeyParams,
  DerivedKeyResult,
  CanonicalRequestInput,
  SignEnvelopeInput,
  SignMessageInput,
  VerifyEnvelopeOptions,
  VerifyRequestInput,
  VerifyRequestOptions,
  VerifyRequestResult,
  VerifySignatureInput,
} from "./types.js";

export interface IdentityCoreBinding {
  hasIdentity?(): Promise<boolean>;
  getIdentity(): Promise<IdentityInfo>;
  getPublicKey?(): Promise<string>;
  signChallenge(challenge: string): Promise<ChallengeSignature>;
  derivePublicKey?(params: DeriveKeyParams): Promise<DerivedKeyResult>;
  signHttpRequest?(input: CanonicalRequestInput): Promise<SignedRequestHeaders>;
  signMessage?(input: SignMessageInput): Promise<SignedMessage>;
  signEnvelope?(input: SignEnvelopeInput): Promise<SignedPayload>;
  verifyEnvelope?(envelope: SignedEnvelope, options?: VerifyEnvelopeOptions): Promise<VerifyResult>;
  verifySignature?(input: VerifySignatureInput): Promise<VerifySignatureResult>;
  verifyRequest?(
    input: VerifyRequestInput,
    options?: VerifyRequestOptions,
  ): Promise<VerifyRequestResult>;
}

export function createIdentityCoreFromBinding(binding: IdentityCoreBinding): IdentityCore {
  return {
    async hasIdentity(): Promise<boolean> {
      return (await binding.hasIdentity?.()) ?? true;
    },

    async getIdentity(): Promise<IdentityInfo> {
      return await binding.getIdentity();
    },

    async getPublicKey(): Promise<string> {
      return (await binding.getPublicKey?.()) ?? (await binding.getIdentity()).publicKey;
    },

    async derivePublicKey(params: DeriveKeyParams): Promise<DerivedKeyResult> {
      if (!binding.derivePublicKey) {
        throw new Error("IdentityCoreBinding does not implement derivePublicKey()");
      }
      return await binding.derivePublicKey(params);
    },

    async signHttpRequest(input: CanonicalRequestInput): Promise<SignedRequestHeaders> {
      if (!binding.signHttpRequest) {
        throw new Error("IdentityCoreBinding does not implement signHttpRequest()");
      }
      return await binding.signHttpRequest(input);
    },

    async signMessage(input: SignMessageInput): Promise<SignedMessage> {
      if (!binding.signMessage) {
        throw new Error("IdentityCoreBinding does not implement signMessage()");
      }
      return await binding.signMessage(input);
    },

    async signEnvelope(input: SignEnvelopeInput): Promise<SignedPayload> {
      if (!binding.signEnvelope) {
        throw new Error("IdentityCoreBinding does not implement signEnvelope()");
      }
      return await binding.signEnvelope(input);
    },

    async signChallenge(challenge: string): Promise<ChallengeSignature> {
      return await binding.signChallenge(challenge);
    },

    async verifyEnvelope(
      envelope: SignedEnvelope,
      options?: VerifyEnvelopeOptions,
    ): Promise<VerifyResult> {
      if (!binding.verifyEnvelope) {
        throw new Error("IdentityCoreBinding does not implement verifyEnvelope()");
      }
      return await binding.verifyEnvelope(envelope, options);
    },

    async verifySignature(input: VerifySignatureInput): Promise<VerifySignatureResult> {
      if (!binding.verifySignature) {
        throw new Error("IdentityCoreBinding does not implement verifySignature()");
      }
      return await binding.verifySignature(input);
    },

    async verifyRequest(
      input: VerifyRequestInput,
      options?: VerifyRequestOptions,
    ): Promise<VerifyRequestResult> {
      if (!binding.verifyRequest) {
        throw new Error("IdentityCoreBinding does not implement verifyRequest()");
      }
      return await binding.verifyRequest(input, options);
    },
  };
}
