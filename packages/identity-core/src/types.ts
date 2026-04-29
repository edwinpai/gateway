export interface IdentityInfo {
  publicKey: string;
  shortId?: string;
  petname?: string;
  avatarSvg?: string;
  fingerprint?: string;
}

export interface DeriveKeyParams {
  protocolId: string;
  keyId: string;
  counterparty: string;
  securityLevel?: 0 | 1 | 2;
}

export interface DerivedKeyResult {
  publicKey: string;
}

export interface CanonicalRequestInput {
  method: string;
  path: string;
  body?: string | object | null;
  timestamp?: number;
  nonce?: string;
}

export interface SignedRequestHeaders {
  "x-bsv-identity-key": string;
  "x-bsv-signature": string;
  "x-bsv-timestamp": string;
  "x-bsv-nonce": string;
}

export interface SignMessageInput {
  message: string;
}

export interface SignedMessage {
  signature: string;
}

export interface SignEnvelopeInput {
  payload: string;
}

export interface SignedEnvelope {
  kid: string;
  alg: string;
  iat: number;
  exp: number;
  nonce: string;
  payloadHash: string;
  sig: string;
  pubKey: string;
}

export interface SignedPayload {
  payload: string;
  envelope: SignedEnvelope;
}

export interface ChallengeSignature {
  publicKey: string;
  signature: string;
  shortId?: string;
}

export interface VerifyEnvelopeOptions {
  expectedPayloadHash?: string;
  authorizedKeys?: string[];
  nowSeconds?: number;
}

export interface VerifyResult {
  valid: boolean;
  error?: string;
  pubKey?: string;
  kid?: string;
}

export interface VerifySignatureInput {
  data: Uint8Array | string;
  signature: string;
  publicKey: string;
}

export interface VerifySignatureResult {
  valid: boolean;
}

export interface VerifyRequestInput {
  method: string;
  path: string;
  body?: string | object;
  timestamp: number;
  nonce: string;
  identityKey: string;
  signature: string;
  certificates?: unknown[];
}

export interface VerifyRequestOptions {
  maxTimestampAge?: number;
  verifyCertificates?: boolean;
  trustedCertifiers?: string[];
  requiredCertificateTypes?: string[];
  skipSignatureVerification?: boolean;
}

export interface VerifyRequestResult {
  valid: boolean;
  error?: string;
  errorCode?: string;
  identity?: {
    identityKey: string;
    lastSeen?: number;
  };
  verifiedCertificates?: unknown[];
  verifiedAt: number;
}

export interface IdentityCore {
  hasIdentity(): Promise<boolean>;
  getIdentity(): Promise<IdentityInfo>;
  getPublicKey(): Promise<string>;
  derivePublicKey(params: DeriveKeyParams): Promise<DerivedKeyResult>;
  signHttpRequest(input: CanonicalRequestInput): Promise<SignedRequestHeaders>;
  signMessage(input: SignMessageInput): Promise<SignedMessage>;
  signEnvelope(input: SignEnvelopeInput): Promise<SignedPayload>;
  signChallenge(challenge: string): Promise<ChallengeSignature>;
  verifyEnvelope(envelope: SignedEnvelope, options?: VerifyEnvelopeOptions): Promise<VerifyResult>;
  verifySignature(input: VerifySignatureInput): Promise<VerifySignatureResult>;
  verifyRequest(
    input: VerifyRequestInput,
    options?: VerifyRequestOptions,
  ): Promise<VerifyRequestResult>;
}
