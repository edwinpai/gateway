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
import { IdentityCoreUnavailableError } from "./errors.js";

const IDENTITY_CORE_NATIVE_MODULE_ENV = "EDWINPAI_IDENTITY_CORE_MODULE";

export interface IdentityCoreFactoryOptions {
  implementation?: IdentityCore;
  loadImplementation?: () => IdentityCore | Promise<IdentityCore>;
  nativeModuleName?: string;
}

export function createIdentityCore(options: IdentityCoreFactoryOptions = {}): IdentityCore {
  if (options.implementation) {
    return options.implementation;
  }

  return new DeferredIdentityCore(options);
}

class DeferredIdentityCore implements IdentityCore {
  #resolved?: IdentityCore;
  #resolution?: Promise<IdentityCore>;
  #resolutionError?: IdentityCoreUnavailableError;
  #options: IdentityCoreFactoryOptions;

  constructor(options: IdentityCoreFactoryOptions) {
    this.#options = options;
  }

  async hasIdentity(): Promise<boolean> {
    if (!hasImplementationHook(this.#options)) {
      return false;
    }

    return (await this.#resolve()).hasIdentity();
  }

  async getIdentity(): Promise<IdentityInfo> {
    return (await this.#resolve()).getIdentity();
  }

  async getPublicKey(): Promise<string> {
    return (await this.#resolve()).getPublicKey();
  }

  async derivePublicKey(params: DeriveKeyParams): Promise<DerivedKeyResult> {
    return (await this.#resolve()).derivePublicKey(params);
  }

  async signHttpRequest(input: CanonicalRequestInput): Promise<SignedRequestHeaders> {
    return (await this.#resolve()).signHttpRequest(input);
  }

  async signMessage(input: SignMessageInput): Promise<SignedMessage> {
    return (await this.#resolve()).signMessage(input);
  }

  async signEnvelope(input: SignEnvelopeInput): Promise<SignedPayload> {
    return (await this.#resolve()).signEnvelope(input);
  }

  async signChallenge(challenge: string): Promise<ChallengeSignature> {
    return (await this.#resolve()).signChallenge(challenge);
  }

  async verifyEnvelope(
    envelope: SignedEnvelope,
    options?: VerifyEnvelopeOptions,
  ): Promise<VerifyResult> {
    return (await this.#resolve()).verifyEnvelope(envelope, options);
  }

  async verifySignature(input: VerifySignatureInput): Promise<VerifySignatureResult> {
    return (await this.#resolve()).verifySignature(input);
  }

  async verifyRequest(
    input: VerifyRequestInput,
    options?: VerifyRequestOptions,
  ): Promise<VerifyRequestResult> {
    return (await this.#resolve()).verifyRequest(input, options);
  }

  async #resolve(): Promise<IdentityCore> {
    if (this.#resolved) {
      return this.#resolved;
    }

    if (this.#resolutionError) {
      throw this.#resolutionError;
    }

    this.#resolution ??= this.#loadImplementation();

    try {
      this.#resolved = await this.#resolution;
      return this.#resolved;
    } catch (error) {
      const wrapped = toUnavailableError(error);
      this.#resolutionError = wrapped;
      throw wrapped;
    }
  }

  async #loadImplementation(): Promise<IdentityCore> {
    if (this.#options.loadImplementation) {
      try {
        return await this.#options.loadImplementation();
      } catch (error) {
        throw unavailable(
          `@edwinpai/identity-core implementation loader failed: ${formatError(error)}`,
        );
      }
    }

    const nativeModuleName = getNativeModuleName(this.#options);
    if (nativeModuleName) {
      let imported: unknown;

      try {
        imported = await import(nativeModuleName);
      } catch (error) {
        throw unavailable(
          `@edwinpai/identity-core failed to import native module "${nativeModuleName}": ${formatError(error)}`,
        );
      }

      return extractIdentityCoreImplementation(imported, nativeModuleName);
    }

    throw unavailable();
  }
}

function hasImplementationHook(options: IdentityCoreFactoryOptions): boolean {
  return Boolean(options.loadImplementation || getNativeModuleName(options));
}

function getNativeModuleName(options: IdentityCoreFactoryOptions): string | undefined {
  return options.nativeModuleName ?? process.env[IDENTITY_CORE_NATIVE_MODULE_ENV];
}

function extractIdentityCoreImplementation(moduleValue: unknown, moduleName: string): IdentityCore {
  const createIdentityCoreExport = (moduleValue as { createIdentityCore?: unknown })
    ?.createIdentityCore;
  const candidate = isIdentityCore(moduleValue)
    ? moduleValue
    : isIdentityCore((moduleValue as { default?: unknown })?.default)
      ? (moduleValue as { default: IdentityCore }).default
      : isIdentityCore((moduleValue as { identityCore?: unknown })?.identityCore)
        ? (moduleValue as { identityCore: IdentityCore }).identityCore
        : typeof createIdentityCoreExport === "function"
          ? (createIdentityCoreExport as () => IdentityCore)()
          : undefined;

  if (!candidate) {
    throw unavailable(
      `@edwinpai/identity-core imported native module "${moduleName}" but it did not expose an IdentityCore implementation`,
    );
  }

  return candidate;
}

function isIdentityCore(value: unknown): value is IdentityCore {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as IdentityCore).getIdentity === "function"
  );
}

function toUnavailableError(error: unknown): IdentityCoreUnavailableError {
  if (error instanceof IdentityCoreUnavailableError) {
    return error;
  }

  return unavailable(`@edwinpai/identity-core is unavailable: ${formatError(error)}`);
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function unavailable(
  message: string = "@edwinpai/identity-core API boundary exists, but the protected native implementation is not wired yet",
): IdentityCoreUnavailableError {
  return new IdentityCoreUnavailableError(message);
}
