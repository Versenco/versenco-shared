import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSso, type Sso, type SsoConfig } from "./index";
import { FakeProvider, type TokenOverrides } from "./test-support/fake-provider";

const REDIRECT = "http://localhost:3000/auth/callback";
let provider: FakeProvider;
let sso: Sso;

function makeSso(patch: Partial<SsoConfig> = {}): Sso {
  return createSso({ issuer: provider.issuer, clientId: "app", clientSecret: "secret", redirectUri: REDIRECT, ...patch });
}

async function start(client: Sso = sso) {
  const req = await client.authorizationUrl();
  return { req, callback: provider.authorize(req.url) };
}

async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject({ name: "SsoError", code });
}

beforeEach(async () => {
  provider = await FakeProvider.start({ clientId: "app", clientSecret: "secret", redirectUri: REDIRECT });
  sso = makeSso();
});
afterEach(() => provider.stop());

describe("authorizationUrl", () => {
  it("builds an authorization code + PKCE S256 request", async () => {
    const { url, state, nonce, codeVerifier } = await sso.authorizationUrl();
    const params = new URL(url).searchParams;
    expect(url.startsWith(`${provider.issuer}/authorize?`)).toBe(true);
    expect(params.get("response_type")).toBe("code");
    expect(params.get("client_id")).toBe("app");
    expect(params.get("redirect_uri")).toBe(REDIRECT);
    expect(params.get("scope")).toBe("openid profile email");
    expect(params.get("code_challenge_method")).toBe("S256");
    expect(params.get("state")).toBe(state);
    expect(params.get("nonce")).toBe(nonce);
    expect(codeVerifier.length).toBeGreaterThanOrEqual(43);
    expect(params.get("code_challenge")).not.toBe(codeVerifier);
  });

  it("fails with discovery_failed when the issuer is unreachable", async () => {
    await expectCode(makeSso({ issuer: "http://127.0.0.1:1" }).authorizationUrl(), "discovery_failed");
  });
});

describe("handleCallback: happy path", () => {
  it("returns validated claims, tokens and the raw id_token", async () => {
    const { req, callback } = await start();
    const result = await sso.handleCallback(callback, req);
    expect(result.claims).toMatchObject({ sub: "user-123", email: "user@example.com", email_verified: true, name: "Test User", sid: "sid-1" });
    expect(result.accessToken).toMatch(/^at-/);
    expect(result.idToken.split(".")).toHaveLength(3);
  });

  it("behaves the same when the issuer has a trailing slash (Review Focus 5)", async () => {
    const slashed = makeSso({ issuer: `${provider.issuer}/` });
    const { req, callback } = await start(slashed);
    const result = await slashed.handleCallback(callback, req);
    expect(result.claims.sub).toBe("user-123");
  });

  it("tolerates a few seconds of clock skew on exp but not a minute (Review Focus 4)", async () => {
    provider.overrides = { expiresInSeconds: -10 };
    const ok = await start();
    await expect(sso.handleCallback(ok.callback, ok.req)).resolves.toBeDefined();

    provider.overrides = { expiresInSeconds: -60 };
    const stale = await start();
    await expectCode(sso.handleCallback(stale.callback, stale.req), "invalid_id_token");
  });
});

describe("handleCallback: authorization response attacks", () => {
  it("rejects a missing state", async () => {
    const { req, callback } = await start();
    callback.searchParams.delete("state");
    await expectCode(sso.handleCallback(callback, req), "invalid_state");
  });

  it("rejects a forged state", async () => {
    const { req, callback } = await start();
    callback.searchParams.set("state", "forged");
    await expectCode(sso.handleCallback(callback, req), "invalid_state");
  });

  it("maps an error returned by the provider to authorization_failed", async () => {
    const { req } = await start();
    const callback = new URL(REDIRECT);
    callback.searchParams.set("error", "access_denied");
    callback.searchParams.set("state", req.state);
    await expectCode(sso.handleCallback(callback, req), "authorization_failed");
  });
});

describe("handleCallback: token endpoint attacks", () => {
  it("rejects a replayed authorization code", async () => {
    const { req, callback } = await start();
    await sso.handleCallback(callback, req);
    await expectCode(sso.handleCallback(callback, req), "token_exchange_failed");
  });

  it("rejects a wrong PKCE code_verifier", async () => {
    const { req, callback } = await start();
    await expectCode(sso.handleCallback(callback, { ...req, codeVerifier: "x".repeat(64) }), "token_exchange_failed");
  });

  it("rejects a wrong client secret", async () => {
    const bad = makeSso({ clientSecret: "nope" });
    const { req, callback } = await start(bad);
    await expectCode(bad.handleCallback(callback, req), "token_exchange_failed");
  });
});

describe("handleCallback: id_token attacks", () => {
  const cases: Array<[string, TokenOverrides]> = [
    ["a different nonce", { nonce: "other-nonce" }],
    ["a missing nonce", { nonce: null }],
    ["a wrong audience", { aud: "someone-else" }],
    ["a wrong issuer", { iss: "https://evil.example" }],
    ["an expired token", { expiresInSeconds: -3600 }],
    ["a signature from another key", { signWith: "other-key" }],
    ["alg=none", { signWith: "none" }],
    ["a forged HS256 token", { signWith: "hs256" }],
  ];

  it.each(cases)("rejects %s", async (_name, overrides) => {
    provider.overrides = overrides;
    const { req, callback } = await start();
    await expectCode(sso.handleCallback(callback, req), "invalid_id_token");
  });
});

describe("userInfo and endSessionUrl", () => {
  it("fetches userinfo and checks the subject", async () => {
    const { req, callback } = await start();
    const login = await sso.handleCallback(callback, req);
    await expect(sso.userInfo(login.accessToken, login.claims.sub)).resolves.toMatchObject({ sub: "user-123", email: "user@example.com" });
    await expectCode(sso.userInfo(login.accessToken, "someone-else"), "userinfo_failed");
    await expectCode(sso.userInfo("bad-token", "user-123"), "userinfo_failed");
  });

  it("builds an end-session URL with the hint, client_id and redirect", async () => {
    const url = await sso.endSessionUrl({ idTokenHint: "hint.jwt.value", postLogoutRedirectUri: "https://app.example.com/" });
    const parsed = new URL(url!);
    expect(parsed.origin + parsed.pathname).toBe(`${provider.issuer}/logout`);
    expect(parsed.searchParams.get("id_token_hint")).toBe("hint.jwt.value");
    expect(parsed.searchParams.get("client_id")).toBe("app");
    expect(parsed.searchParams.get("post_logout_redirect_uri")).toBe("https://app.example.com/");
  });
});
