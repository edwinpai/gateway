export type IdentityCoreErrorCode =
  | "IDENTITY_NOT_FOUND"
  | "INVALID_INPUT"
  | "INVALID_PUBLIC_KEY"
  | "INVALID_SIGNATURE"
  | "INVALID_ENVELOPE"
  | "SIGNATURE_EXPIRED"
  | "REPLAY_DETECTED"
  | "UNAUTHORIZED_KEY"
  | "DERIVATION_FAILED"
  | "SIGNING_FAILED"
  | "UNAVAILABLE"
  | "INTERNAL_ERROR";

export class IdentityCoreError extends Error {
  readonly code: IdentityCoreErrorCode;

  constructor(code: IdentityCoreErrorCode, message: string) {
    super(message);
    this.name = "IdentityCoreError";
    this.code = code;
  }
}

export class IdentityCoreUnavailableError extends IdentityCoreError {
  constructor(message: string = "@edwinpai/identity-core native implementation is not wired yet") {
    super("UNAVAILABLE", message);
    this.name = "IdentityCoreUnavailableError";
  }
}
