export type SsoErrorCode =
  | "config_invalid"
  | "discovery_failed"
  | "invalid_state"
  | "authorization_failed"
  | "token_exchange_failed"
  | "invalid_id_token"
  | "userinfo_failed"
  | "login_rejected";

/** Every failure raised by this package. Messages never contain secrets or tokens. */
export class SsoError extends Error {
  readonly code: SsoErrorCode;

  constructor(code: SsoErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SsoError";
    this.code = code;
  }
}
