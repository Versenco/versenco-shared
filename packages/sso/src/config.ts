import { SsoError } from "./errors";

export interface SsoConfig {
  /** Base URL of the identity provider, e.g. https://auth.versenco.com */
  issuer: string;
  clientId: string;
  clientSecret: string;
  /** The exact callback URL registered for this client. */
  redirectUri: string;
  /** Defaults to ["openid", "profile", "email"]. Must include "openid". */
  scopes?: string[];
}

export interface ResolvedSsoConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function parseUrl(name: string, value: string): URL {
  try {
    return new URL(value);
  } catch {
    throw new SsoError("config_invalid", `${name} must be an absolute URL`);
  }
}

function assertSecureUrl(name: string, url: URL): void {
  if (url.protocol === "https:") return;
  if (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname)) return;
  throw new SsoError("config_invalid", `${name} must use https (http is only allowed on localhost)`);
}

export function resolveConfig(config: SsoConfig): ResolvedSsoConfig {
  assertSecureUrl("issuer", parseUrl("issuer", config.issuer));
  assertSecureUrl("redirectUri", parseUrl("redirectUri", config.redirectUri));
  if (!config.clientId?.trim()) throw new SsoError("config_invalid", "clientId is required");
  if (!config.clientSecret?.trim()) throw new SsoError("config_invalid", "clientSecret is required");

  const scopes = config.scopes?.length ? config.scopes : ["openid", "profile", "email"];
  if (!scopes.includes("openid")) throw new SsoError("config_invalid", 'scopes must include "openid"');

  return {
    issuer: config.issuer.replace(/\/+$/, ""),
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    redirectUri: config.redirectUri,
    scopes,
  };
}

export function assertSessionSecret(secret: string): void {
  if (typeof secret !== "string" || new TextEncoder().encode(secret).length < 32) {
    throw new SsoError("config_invalid", "sessionSecret must be at least 32 bytes");
  }
}
