import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeProvider } from "../test-support/fake-provider";
import { verifySession } from "../session";
import { createNextSso, type NextSsoOptions } from "./index";

const APP = "http://localhost:3000";
const REDIRECT = `${APP}/auth/callback`;
const SECRET = "a-test-secret-that-is-at-least-32-bytes-long";
let provider: FakeProvider;
let app: ReturnType<typeof createNextSso>;
let logins: string[];

function build(patch: Partial<NextSsoOptions> = {}) {
  return createNextSso({
    issuer: provider.issuer,
    clientId: "app",
    clientSecret: "secret",
    redirectUri: REDIRECT,
    sessionSecret: SECRET,
    onLogin: (claims) => {
      logins.push(claims.sub);
    },
    ...patch,
  });
}

function cookieValue(res: Response, name: string): string | undefined {
  for (const line of res.headers.getSetCookie()) {
    if (line.startsWith(`${name}=`)) return line.slice(name.length + 1).split(";")[0];
  }
  return undefined;
}
function setCookieLine(res: Response, name: string): string | undefined {
  return res.headers.getSetCookie().find((line) => line.startsWith(`${name}=`));
}

/** Runs /login and returns what a browser would hold afterwards. */
async function beginLogin(returnTo?: string) {
  const query = returnTo === undefined ? "" : `?returnTo=${encodeURIComponent(returnTo)}`;
  const login = await app.handlers.login(new Request(`${APP}/auth/login${query}`));
  const oauthCookie = cookieValue(login, "versen_oauth")!;
  const callbackUrl = provider.authorize(login.headers.get("location")!);
  return { login, oauthCookie, callbackUrl };
}
function callbackRequest(callbackUrl: URL, oauthCookie?: string) {
  return new Request(callbackUrl, { headers: oauthCookie ? { cookie: `versen_oauth=${oauthCookie}` } : {} });
}

beforeEach(async () => {
  logins = [];
  provider = await FakeProvider.start({ clientId: "app", clientSecret: "secret", redirectUri: REDIRECT });
  app = build();
});
afterEach(() => provider.stop());

describe("createNextSso", () => {
  it("fails at startup when sessionSecret is too short", () => {
    expect(() => build({ sessionSecret: "short" })).toThrowError(expect.objectContaining({ code: "config_invalid" }));
  });
});

describe("login handler", () => {
  it("redirects to the provider and stores the login state in a short-lived HttpOnly cookie", async () => {
    const { login } = await beginLogin("/dashboard");
    expect(login.status).toBe(302);
    expect(login.headers.get("location")!.startsWith(`${provider.issuer}/authorize?`)).toBe(true);
    const line = setCookieLine(login, "versen_oauth")!;
    expect(line).toContain("HttpOnly");
    expect(line).toContain("SameSite=Lax");
    expect(line).toContain("Max-Age=600");
    expect(line).not.toContain("Secure"); // http://localhost
    expect(login.headers.get("cache-control")).toBe("no-store");
  });
});

describe("callback handler", () => {
  it("creates a session, clears the login state and lands on returnTo", async () => {
    const { oauthCookie, callbackUrl } = await beginLogin("/dashboard");
    const res = await app.handlers.callback(callbackRequest(callbackUrl, oauthCookie));

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${APP}/dashboard`);
    expect(logins).toEqual(["user-123"]);

    const sessionLine = setCookieLine(res, "versen_session")!;
    expect(sessionLine).toContain("HttpOnly");
    expect(sessionLine).toContain("SameSite=Lax");
    expect(sessionLine).toContain("Max-Age=28800");
    const session = await verifySession(SECRET, cookieValue(res, "versen_session")!);
    expect(session).toMatchObject({ sub: "user-123", email: "user@example.com", sid: "sid-1" });
    expect(session!.idToken).toBeDefined();
    expect(setCookieLine(res, "versen_oauth")).toContain("Max-Age=0");
  });

  it("sends a tampered returnTo to / (Review Focus 2)", async () => {
    const { oauthCookie, callbackUrl } = await beginLogin("//evil.com");
    const res = await app.handlers.callback(callbackRequest(callbackUrl, oauthCookie));
    expect(res.headers.get("location")).toBe(`${APP}/`);
  });

  it("redirects to the error page when the login-state cookie is missing", async () => {
    const { callbackUrl } = await beginLogin();
    const res = await app.handlers.callback(callbackRequest(callbackUrl));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${APP}/auth/error?code=invalid_state`);
    expect(cookieValue(res, "versen_session")).toBeUndefined();
  });

  it("redirects to the error page when the login-state cookie is forged", async () => {
    const { callbackUrl } = await beginLogin();
    const res = await app.handlers.callback(callbackRequest(callbackUrl, "forged.cookie.value"));
    expect(res.headers.get("location")).toBe(`${APP}/auth/error?code=invalid_state`);
  });

  it("handles a second visit of the callback with an error redirect, not a 500 (Review Focus 1)", async () => {
    const { oauthCookie, callbackUrl } = await beginLogin();
    const first = await app.handlers.callback(callbackRequest(callbackUrl, oauthCookie));
    expect(first.headers.get("location")).toBe(`${APP}/`);

    const second = await app.handlers.callback(callbackRequest(callbackUrl, oauthCookie));
    expect(second.status).toBe(302);
    expect(second.headers.get("location")).toBe(`${APP}/auth/error?code=token_exchange_failed`);
    expect(cookieValue(second, "versen_session")).toBeUndefined();
  });

  it("creates no session when onLogin throws", async () => {
    app = build({ onLogin: () => { throw new Error("user is banned"); } });
    const { oauthCookie, callbackUrl } = await beginLogin();
    const res = await app.handlers.callback(callbackRequest(callbackUrl, oauthCookie));
    expect(res.headers.get("location")).toBe(`${APP}/auth/error?code=login_rejected`);
    expect(cookieValue(res, "versen_session")).toBeUndefined();
  });

  it("omits the id_token hint rather than overflowing the cookie (Review Focus 3)", async () => {
    provider.profile.name = "a".repeat(1000); // ~4.4 KB session with the id_token, ~1.5 KB without
    const { oauthCookie, callbackUrl } = await beginLogin();
    const res = await app.handlers.callback(callbackRequest(callbackUrl, oauthCookie));
    const token = cookieValue(res, "versen_session")!;
    expect(token.length).toBeLessThan(3800);
    const session = await verifySession(SECRET, token);
    expect(session).toMatchObject({ sub: "user-123" });
    expect(session!.idToken).toBeUndefined();
  });

  it("uses a custom cookie prefix", async () => {
    app = build({ cookiePrefix: "acme" });
    const login = await app.handlers.login(new Request(`${APP}/auth/login`));
    expect(cookieValue(login, "acme_oauth")).toBeDefined();
    expect(cookieValue(login, "versen_oauth")).toBeUndefined();
  });
});

describe("logout handler", () => {
  async function signIn() {
    const { oauthCookie, callbackUrl } = await beginLogin();
    const res = await app.handlers.callback(callbackRequest(callbackUrl, oauthCookie));
    return cookieValue(res, "versen_session")!;
  }

  it("clears the session and ends the SSO session with the id_token hint", async () => {
    const session = await signIn();
    const res = await app.handlers.logout(new Request(`${APP}/auth/logout`, { headers: { cookie: `versen_session=${session}` } }));
    const location = new URL(res.headers.get("location")!);
    expect(location.origin + location.pathname).toBe(`${provider.issuer}/logout`);
    expect(location.searchParams.get("id_token_hint")).toBeTruthy();
    expect(location.searchParams.get("client_id")).toBe("app");
    expect(setCookieLine(res, "versen_session")).toContain("Max-Age=0");
  });

  it("just clears the cookie and goes home when there is no session", async () => {
    const res = await app.handlers.logout(new Request(`${APP}/auth/logout`));
    expect(res.headers.get("location")).toBe(`${APP}/`);
    expect(setCookieLine(res, "versen_session")).toContain("Max-Age=0");
  });
});
