import * as oauth from "oauth4webapi";
import { resolveConfig, type SsoConfig } from "./config";
import { SsoError } from "./errors";

export interface AuthorizationRequest {
  url: string;
  state: string;
  nonce: string;
  codeVerifier: string;
}

export interface CallbackChecks {
  state: string;
  nonce: string;
  codeVerifier: string;
}

export interface IdentityClaims {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  sid?: string;
  iat: number;
  exp: number;
}

export interface LoginResult {
  claims: IdentityClaims;
  accessToken: string;
  idToken: string;
}

export interface UserInfo {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
}

export interface Sso {
  authorizationUrl(): Promise<AuthorizationRequest>;
  handleCallback(callbackUrl: string | URL, checks: CallbackChecks): Promise<LoginResult>;
  userInfo(accessToken: string, expectedSub: string): Promise<UserInfo>;
  endSessionUrl(options: { idTokenHint?: string; postLogoutRedirectUri?: string }): Promise<string | null>;
}

/**
 * oauth4webapi errors can carry tokens, the authorization code, claims and response
 * bodies (`cause`, `parameters`, `body`, `response`). Only network failures keep their
 * cause; everything else is reduced to four primitive fields.
 */
function safeCause(cause: unknown): unknown {
  if (cause instanceof TypeError) return cause;
  if (typeof cause !== "object" || cause === null) return undefined;
  const e = cause as Record<string, unknown>;
  const pick = (v: unknown) => (typeof v === "string" || typeof v === "number" ? v : undefined);
  return { name: pick(e.name), code: pick(e.code), error: pick(e.error), status: pick(e.status) };
}

/** Failures that mean the exchange itself went wrong, not that the token is forged. */
function isExchangeFailure(cause: unknown): boolean {
  if (cause instanceof TypeError || cause instanceof oauth.UnsupportedOperationError) return true;
  if (cause instanceof oauth.ResponseBodyError || cause instanceof oauth.WWWAuthenticateChallengeError) return true;
  return (cause as { code?: unknown } | null)?.code === oauth.RESPONSE_IS_NOT_CONFORM;
}

const DISCOVERY_TTL_MS = 60 * 60 * 1000;
const CLOCK_TOLERANCE_SECONDS = 30;

export function createSso(input: SsoConfig): Sso {
  const config = resolveConfig(input);
  const issuer = new URL(config.issuer);
  // Plain http is only reachable for loopback issuers (enforced by resolveConfig).
  const http = issuer.protocol === "http:" ? { [oauth.allowInsecureRequests]: true } : {};
  const client: oauth.Client = { client_id: config.clientId, [oauth.clockTolerance]: CLOCK_TOLERANCE_SECONDS };
  const clientAuth = oauth.ClientSecretPost(config.clientSecret);

  let cached: { at: number; server: Promise<oauth.AuthorizationServer> } | undefined;

  function discover(): Promise<oauth.AuthorizationServer> {
    if (cached && Date.now() - cached.at < DISCOVERY_TTL_MS) return cached.server;
    const server = (async () => {
      const response = await oauth.discoveryRequest(issuer, { algorithm: "oidc", ...http });
      return oauth.processDiscoveryResponse(issuer, response);
    })().catch((cause) => {
      cached = undefined;
      throw new SsoError("discovery_failed", "Could not load the OpenID configuration of the issuer", { cause: safeCause(cause) });
    });
    cached = { at: Date.now(), server };
    return server;
  }

  return {
    async authorizationUrl() {
      const server = await discover();
      const codeVerifier = oauth.generateRandomCodeVerifier();
      const state = oauth.generateRandomState();
      const nonce = oauth.generateRandomNonce();
      if (!server.authorization_endpoint) {
        throw new SsoError("discovery_failed", "The issuer does not advertise an authorization endpoint");
      }
      const url = new URL(server.authorization_endpoint);
      url.searchParams.set("client_id", config.clientId);
      url.searchParams.set("redirect_uri", config.redirectUri);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", config.scopes.join(" "));
      url.searchParams.set("code_challenge", await oauth.calculatePKCECodeChallenge(codeVerifier));
      url.searchParams.set("code_challenge_method", "S256");
      url.searchParams.set("state", state);
      url.searchParams.set("nonce", nonce);
      return { url: url.href, state, nonce, codeVerifier };
    },

    async handleCallback(callbackUrl, checks) {
      const server = await discover();
      const url = new URL(callbackUrl);

      if (url.searchParams.get("state") !== checks.state) {
        throw new SsoError("invalid_state", "The state returned by the provider does not match the sign-in request");
      }
      let params: URLSearchParams;
      try {
        params = oauth.validateAuthResponse(server, client, url, checks.state);
      } catch (cause) {
        if (cause instanceof oauth.AuthorizationResponseError) {
          throw new SsoError("authorization_failed", "The provider returned an authorization error", { cause: safeCause(cause) });
        }
        throw new SsoError("invalid_state", "The authorization response is invalid", { cause: safeCause(cause) });
      }

      let response: Response;
      try {
        response = await oauth.authorizationCodeGrantRequest(
          server, client, clientAuth, params, config.redirectUri, checks.codeVerifier, http,
        );
      } catch (cause) {
        throw new SsoError("token_exchange_failed", "The token request failed", { cause: safeCause(cause) });
      }

      // One clone, passed to BOTH calls: the signature check needs the exact
      // Response instance that was processed, not a fresh clone.
      const processed = response.clone();
      let result: oauth.TokenEndpointResponse;
      try {
        result = await oauth.processAuthorizationCodeResponse(server, client, processed, {
          expectedNonce: checks.nonce,
          requireIdToken: true,
        });
      } catch (cause) {
        if (isExchangeFailure(cause)) {
          throw new SsoError("token_exchange_failed", "The token endpoint rejected the request", { cause: safeCause(cause) });
        }
        throw new SsoError("invalid_id_token", "The id_token failed validation", { cause: safeCause(cause) });
      }

      // oauth4webapi treats signature checking as optional (it trusts TLS); we always do it.
      try {
        await oauth.validateApplicationLevelSignature(server, processed, http);
      } catch (cause) {
        throw new SsoError(
          isExchangeFailure(cause) ? "token_exchange_failed" : "invalid_id_token",
          "The id_token signature could not be verified",
          { cause: safeCause(cause) },
        );
      }

      const claims = oauth.getValidatedIdTokenClaims(result);
      if (!claims) throw new SsoError("invalid_id_token", "The token response carries no id_token");
      return {
        claims: claims as unknown as IdentityClaims,
        accessToken: result.access_token,
        idToken: result.id_token!,
      };
    },

    async userInfo(accessToken, expectedSub) {
      const server = await discover();
      try {
        const response = await oauth.userInfoRequest(server, client, accessToken, http);
        return (await oauth.processUserInfoResponse(server, client, expectedSub, response)) as UserInfo;
      } catch (cause) {
        throw new SsoError("userinfo_failed", "Could not fetch the user profile", { cause: safeCause(cause) });
      }
    },

    async endSessionUrl({ idTokenHint, postLogoutRedirectUri }) {
      const server = await discover();
      if (!server.end_session_endpoint) return null;
      const url = new URL(server.end_session_endpoint);
      if (idTokenHint) url.searchParams.set("id_token_hint", idTokenHint);
      url.searchParams.set("client_id", config.clientId);
      if (postLogoutRedirectUri) url.searchParams.set("post_logout_redirect_uri", postLogoutRedirectUri);
      return url.href;
    },
  };
}
