import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { inspect } from "node:util";
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
afterEach(async () => {
  vi.restoreAllMocks();
  await provider.stop();
});

/** Wraps fetch so a test can rewrite the JSON body of one provider endpoint. */
function rewriteJson(pathname: string, edit: (body: Record<string, unknown>) => void) {
  const real = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const res = await real(input, init);
    if (new URL(input instanceof Request ? input.url : String(input)).pathname !== pathname) return res;
    const body = (await res.json()) as Record<string, unknown>;
    edit(body);
    return new Response(JSON.stringify(body), { status: res.status, headers: { "content-type": "application/json" } });
  });
}

/** Everything a logger could serialize from an error: full inspect output plus JSON of each cause. */
function dump(err: unknown): string {
  const parts = [inspect(err, { depth: null, showHidden: true })];
  for (let e: unknown = err; e; e = (e as { cause?: unknown }).cause) {
    parts.push(String(e), JSON.stringify(e));
  }
  return parts.join("\n");
}

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

describe("error hygiene", () => {
  function expectNoLeak(err: unknown, secrets: Array<string | null>) {
    const text = dump(err);
    for (const secret of secrets) {
      expect(secret).toBeTruthy();
      expect(text).not.toContain(secret!);
    }
  }

  it("does not leak tokens or the code when the id_token is missing", async () => {
    let leaked: Record<string, unknown> = {};
    rewriteJson("/token", (body) => {
      leaked = { ...body };
      delete body.id_token;
    });
    const { req, callback } = await start();
    const err = await sso.handleCallback(callback, req).catch((e) => e);
    expect(err).toMatchObject({ name: "SsoError", code: "invalid_id_token" });
    expectNoLeak(err, [leaked.access_token as string, leaked.id_token as string, callback.searchParams.get("code")]);
  });

  it("does not leak the code when the token endpoint rejects a replay", async () => {
    const { req, callback } = await start();
    await sso.handleCallback(callback, req);
    const err = await sso.handleCallback(callback, req).catch((e) => e);
    expect(err).toMatchObject({ name: "SsoError", code: "token_exchange_failed" });
    expectNoLeak(err, [callback.searchParams.get("code")]);
  });
});

describe("discovery and metadata", () => {
  it("rejects an authorization response whose iss does not match the issuer", async () => {
    const { req, callback } = await start();
    callback.searchParams.set("iss", "https://evil.example");
    await expectCode(sso.handleCallback(callback, req), "invalid_state");
  });

  it("returns null from endSessionUrl when the provider has no end_session_endpoint", async () => {
    rewriteJson("/.well-known/openid-configuration", (body) => delete body.end_session_endpoint);
    await expect(sso.endSessionUrl({})).resolves.toBeNull();
  });

  it("raises discovery_failed when authorization_endpoint is missing", async () => {
    rewriteJson("/.well-known/openid-configuration", (body) => delete body.authorization_endpoint);
    await expectCode(sso.authorizationUrl(), "discovery_failed");
  });

  it("retries discovery after a failure instead of caching it", async () => {
    const real = globalThis.fetch;
    let calls = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      if (calls++ === 0) return Promise.reject(new TypeError("fetch failed"));
      return real(input, init);
    });
    await expectCode(sso.authorizationUrl(), "discovery_failed");
    await expect(sso.authorizationUrl()).resolves.toMatchObject({ state: expect.any(String) });
  });
});
