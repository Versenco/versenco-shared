import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { assertSessionSecret, type SsoConfig } from "../config";
import { createSso, type IdentityClaims, type Sso } from "../core";
import { SsoError } from "../errors";
import {
  clearCookie,
  parseCookies,
  safeReturnTo,
  serializeCookie,
  signOauthCookie,
  signSession,
  verifyOauthCookie,
  verifySession,
  type Session as InternalSession,
} from "../session";

/** What the readers return. The id_token stays inside the cookie and is never handed to app code. */
export type Session = Omit<InternalSession, "idToken">;

function publicSession(session: InternalSession | null): Session | null {
  if (!session) return null;
  const { idToken: _idToken, ...rest } = session;
  return rest;
}

/** Appends a query parameter, respecting a query string already present in `path`. */
function withParam(path: string, key: string, value: string): string {
  const url = new URL(path, "http://placeholder.invalid");
  url.searchParams.set(key, value);
  return url.pathname + url.search;
}

export interface NextSsoOptions extends SsoConfig {
  /** At least 32 bytes. Signs the session and login-state cookies. */
  sessionSecret: string;
  /** Absolute session lifetime. Default 8 hours. No sliding expiry. */
  sessionTtlSeconds?: number;
  /** Cookies are named `<prefix>_session` and `<prefix>_oauth`. Default "versen". */
  cookiePrefix?: string;
  /** Where requireSession() sends anonymous visitors. Default "/auth/login". */
  loginPath?: string;
  /** Where failed sign-ins land, with `?code=<SsoErrorCode>`. Default "/auth/error". */
  errorPath?: string;
  /** Default destination after sign-in and sign-out. Default "/". */
  defaultReturnTo?: string;
  /** Registered post-logout redirect URI on the SSO client, if any. */
  postLogoutRedirectUri?: string;
  /** Create or update the app's own user here. Throwing aborts the sign-in. */
  onLogin?: (claims: IdentityClaims) => void | Promise<void>;
}

// Browsers drop cookies over ~4096 bytes; keep headroom for name and attributes.
const MAX_SESSION_TOKEN_LENGTH = 3800;
const LOGIN_STATE_TTL_SECONDS = 600;

export function createNextSso(options: NextSsoOptions) {
  assertSessionSecret(options.sessionSecret);
  if (options.sessionTtlSeconds !== undefined && !(Number.isInteger(options.sessionTtlSeconds) && options.sessionTtlSeconds > 0)) {
    throw new SsoError("config_invalid", "sessionTtlSeconds must be a positive integer");
  }
  if (options.cookiePrefix !== undefined && !/^[A-Za-z0-9_-]+$/.test(options.cookiePrefix)) {
    throw new SsoError("config_invalid", "cookiePrefix may only contain letters, digits, '_' and '-'");
  }
  const sso: Sso = createSso(options);
  const secret = options.sessionSecret;
  const prefix = options.cookiePrefix ?? "versen";
  const cookieNames = { session: `${prefix}_session`, oauth: `${prefix}_oauth` };
  const ttl = options.sessionTtlSeconds ?? 8 * 60 * 60;
  const appUrl = new URL(options.redirectUri);
  const secure = !(appUrl.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(appUrl.hostname));
  const errorPath = options.errorPath ?? "/auth/error";
  const home = safeReturnTo(options.defaultReturnTo ?? "/");

  function redirectTo(target: string, cookies: string[] = []): Response {
    const headers = new Headers({ location: new URL(target, appUrl).href, "cache-control": "no-store" });
    for (const cookie of cookies) headers.append("set-cookie", cookie);
    return new Response(null, { status: 302, headers });
  }

  function fail(error: SsoError, cookies: string[] = []): Response {
    return redirectTo(withParam(errorPath, "code", error.code), cookies);
  }

  const handlers = {
    async login(req: Request): Promise<Response> {
      try {
        const returnTo = safeReturnTo(new URL(req.url).searchParams.get("returnTo") ?? home);
        const auth = await sso.authorizationUrl();
        const token = await signOauthCookie(
          secret,
          { state: auth.state, nonce: auth.nonce, codeVerifier: auth.codeVerifier, returnTo },
          LOGIN_STATE_TTL_SECONDS,
        );
        return redirectTo(auth.url, [serializeCookie(cookieNames.oauth, token, { maxAge: LOGIN_STATE_TTL_SECONDS, secure })]);
      } catch (err) {
        if (err instanceof SsoError) return fail(err);
        throw err;
      }
    },

    async callback(req: Request): Promise<Response> {
      const clearLoginState = clearCookie(cookieNames.oauth, secure);
      try {
        const raw = parseCookies(req.headers.get("cookie")).get(cookieNames.oauth);
        const saved = raw ? await verifyOauthCookie(secret, raw) : null;
        if (!saved) throw new SsoError("invalid_state", "Missing or expired sign-in state");

        // Rebuild the callback URL on the configured origin: behind a proxy req.url may be internal.
        const callbackUrl = new URL(options.redirectUri);
        callbackUrl.search = new URL(req.url).search;
        const result = await sso.handleCallback(callbackUrl, saved);

        try {
          await options.onLogin?.(result.claims);
        } catch (cause) {
          throw new SsoError("login_rejected", "The application rejected this sign-in", { cause });
        }

        const base = { sub: result.claims.sub, email: result.claims.email, name: result.claims.name, sid: result.claims.sid };
        let token = await signSession(secret, { ...base, idToken: result.idToken }, ttl);
        if (token.length > MAX_SESSION_TOKEN_LENGTH) token = await signSession(secret, base, ttl);
        if (token.length > MAX_SESSION_TOKEN_LENGTH) {
          throw new SsoError("config_invalid", "Session cookie would exceed the browser size limit");
        }

        return redirectTo(safeReturnTo(saved.returnTo), [
          serializeCookie(cookieNames.session, token, { maxAge: ttl, secure }),
          clearLoginState,
        ]);
      } catch (err) {
        if (err instanceof SsoError) return fail(err, [clearLoginState]);
        throw err;
      }
    },

    async logout(req: Request): Promise<Response> {
      const cleared = clearCookie(cookieNames.session, secure);
      const raw = parseCookies(req.headers.get("cookie")).get(cookieNames.session);
      const session = raw ? await verifySession(secret, raw) : null;
      if (!session) return redirectTo(home, [cleared]);

      const endSession = await sso
        .endSessionUrl({ idTokenHint: session.idToken, postLogoutRedirectUri: options.postLogoutRedirectUri })
        .catch(() => null);
      return redirectTo(endSession ?? home, [cleared]);
    },
  };

  const loginPath = options.loginPath ?? "/auth/login";

  async function getSession(): Promise<Session | null> {
    const raw = (await cookies()).get(cookieNames.session)?.value;
    return raw ? publicSession(await verifySession(secret, raw)) : null;
  }

  async function requireSession(returnTo?: string): Promise<Session> {
    const session = await getSession();
    if (session) return session;
    redirect(returnTo === undefined ? loginPath : withParam(loginPath, "returnTo", safeReturnTo(returnTo)));
  }

  /** For proxy.ts, where `cookies()` from next/headers is unavailable. */
  async function getSessionFromRequest(req: Request): Promise<Session | null> {
    const raw = parseCookies(req.headers.get("cookie")).get(cookieNames.session);
    return raw ? publicSession(await verifySession(secret, raw)) : null;
  }

  return { sso, handlers, cookieNames, getSession, requireSession, getSessionFromRequest };
}

export type { IdentityClaims } from "../core";
export { SsoError } from "../errors";
export type { SsoErrorCode } from "../errors";
