import type {
  CanonicalRequestInput,
  ChallengeSignature,
  DeriveKeyParams,
  DerivedKeyResult,
  IdentityCore,
  IdentityInfo,
  SignedEnvelope,
  SignedMessage,
  SignedPayload,
  SignedRequestHeaders,
  SignEnvelopeInput,
  SignMessageInput,
  VerifyEnvelopeOptions,
  VerifyRequestInput,
  VerifyRequestOptions,
  VerifyRequestResult,
  VerifyResult,
  VerifySignatureInput,
  VerifySignatureResult,
} from "./types.js";

export interface NodeIdentityCoreTransport {
  hasIdentity?(): Promise<boolean>;
  getIdentity?(): Promise<IdentityInfo>;
  getPublicKey(): Promise<string>;
  signHttpRequest(input: CanonicalRequestInput): Promise<SignedRequestHeaders>;
  signMessage?(input: SignMessageInput): Promise<SignedMessage>;
  signEnvelope?(input: SignEnvelopeInput): Promise<SignedPayload>;
  verifyEnvelope?(envelope: SignedEnvelope, options?: VerifyEnvelopeOptions): Promise<VerifyResult>;
  verifySignature?(input: VerifySignatureInput): Promise<VerifySignatureResult>;
  verifyRequest?(
    input: VerifyRequestInput,
    options?: VerifyRequestOptions,
  ): Promise<VerifyRequestResult>;
}

export function createNodeIdentityCoreBinding(transport: NodeIdentityCoreTransport): IdentityCore {
  return {
    async hasIdentity(): Promise<boolean> {
      return (await transport.hasIdentity?.()) ?? true;
    },

    async getIdentity(): Promise<IdentityInfo> {
      if (transport.getIdentity) {
        return await transport.getIdentity();
      }
      return {
        publicKey: await transport.getPublicKey(),
      };
    },

    async getPublicKey(): Promise<string> {
      return await transport.getPublicKey();
    },

    async derivePublicKey(_params: DeriveKeyParams): Promise<DerivedKeyResult> {
      throw unsupported("derivePublicKey");
    },

    async signHttpRequest(input: CanonicalRequestInput): Promise<SignedRequestHeaders> {
      return await transport.signHttpRequest(input);
    },

    async signMessage(input: SignMessageInput): Promise<SignedMessage> {
      if (!transport.signMessage) {
        throw unsupported("signMessage");
      }
      return await transport.signMessage(input);
    },

    async signEnvelope(input: SignEnvelopeInput): Promise<SignedPayload> {
      if (!transport.signEnvelope) {
        throw unsupported("signEnvelope");
      }
      return await transport.signEnvelope(input);
    },

    async signChallenge(_challenge: string): Promise<ChallengeSignature> {
      throw unsupported("signChallenge");
    },

    async verifyEnvelope(
      envelope: SignedEnvelope,
      options?: VerifyEnvelopeOptions,
    ): Promise<VerifyResult> {
      if (!transport.verifyEnvelope) {
        throw unsupported("verifyEnvelope");
      }
      return await transport.verifyEnvelope(envelope, options);
    },

    async verifySignature(input: VerifySignatureInput): Promise<VerifySignatureResult> {
      if (!transport.verifySignature) {
        throw unsupported("verifySignature");
      }
      return await transport.verifySignature(input);
    },

    async verifyRequest(
      input: VerifyRequestInput,
      options?: VerifyRequestOptions,
    ): Promise<VerifyRequestResult> {
      if (!transport.verifyRequest) {
        throw unsupported("verifyRequest");
      }
      return await transport.verifyRequest(input, options);
    },
  };
}

function unsupported(method: string): Error {
  return new Error(`NodeIdentityCoreTransport does not implement ${method}()`);
}
