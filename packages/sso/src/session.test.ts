import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import {
  clearCookie,
  parseCookies,
  safeReturnTo,
  serializeCookie,
  signOauthCookie,
  signSession,
  verifyOauthCookie,
  verifySession,
} from "./session";

const SECRET = "a-test-secret-that-is-at-least-32-bytes-long";
const OTHER = "another-secret-that-is-at-least-32-bytes!!";
const data = { sub: "user-123", email: "user@example.com", name: "Test User", sid: "sid-1", idToken: "a.b.c" };

describe("session token", () => {
  it("round-trips the session data", async () => {
    const session = await verifySession(SECRET, await signSession(SECRET, data, 3600));
    expect(session).toMatchObject(data);
    expect(session!.exp - session!.iat).toBe(3600);
  });

  it("rejects a token signed with another secret", async () => {
    expect(await verifySession(OTHER, await signSession(SECRET, data, 3600))).toBeNull();
  });

  it("rejects a tampered token", async () => {
    const token = await signSession(SECRET, data, 3600);
    const [h, p, s] = token.split(".");
    const forged = `${h}.${Buffer.from(JSON.stringify({ sub: "admin" })).toString("base64url")}.${s}`;
    expect(await verifySession(SECRET, forged)).toBeNull();
    expect(await verifySession(SECRET, `${h}.${p}.`)).toBeNull();
  });

  it("rejects an expired token", async () => {
    const twoHoursAgo = Date.now() - 2 * 3600 * 1000;
    expect(await verifySession(SECRET, await signSession(SECRET, data, 3600, twoHoursAgo))).toBeNull();
  });

  it("returns null for garbage", async () => {
    expect(await verifySession(SECRET, "not-a-jwt")).toBeNull();
    expect(await verifySession(SECRET, "")).toBeNull();
  });
});

describe("login-state cookie", () => {
  const state = { state: "s", nonce: "n", codeVerifier: "v", returnTo: "/dashboard" };

  it("round-trips", async () => {
    expect(await verifyOauthCookie(SECRET, await signOauthCookie(SECRET, state))).toMatchObject(state);
  });

  it("expires after its TTL", async () => {
    const old = Date.now() - 11 * 60 * 1000;
    expect(await verifyOauthCookie(SECRET, await signOauthCookie(SECRET, state, 600, old))).toBeNull();
  });

  it("cannot be used as a session, nor a session as a login state", async () => {
    expect(await verifySession(SECRET, await signOauthCookie(SECRET, state))).toBeNull();
    expect(await verifyOauthCookie(SECRET, await signSession(SECRET, data, 3600))).toBeNull();
  });
});

describe("safeReturnTo (Review Focus 2)", () => {
  it.each([
    ["/dashboard", "/dashboard"],
    ["/a/b?x=1#frag", "/a/b?x=1#frag"],
    ["//evil.com", "/"],
    ["/\\evil.com", "/"],
    ["https://evil.com", "/"],
    ["javascript:alert(1)", "/"],
    ["/ok\nSet-Cookie: x=1", "/"],
    ["\\evil.com", "/"],
    ["/%09/evil", "/%09/evil"],
    ["", "/"],
    [null, "/"],
    [undefined, "/"],
  ])("%j -> %j", (input, expected) => {
    expect(safeReturnTo(input as string | null | undefined)).toBe(expected);
  });
});

describe("cookie helpers", () => {
  it("serializes HttpOnly, SameSite=Lax cookies and adds Secure on demand", () => {
    expect(serializeCookie("c", "v", { maxAge: 60, secure: true })).toBe("c=v; Path=/; Max-Age=60; HttpOnly; SameSite=Lax; Secure");
    expect(serializeCookie("c", "v", { maxAge: 60, secure: false })).not.toContain("Secure");
  });

  it("clears a cookie with Max-Age=0", () => {
    expect(clearCookie("c", false)).toContain("Max-Age=0");
  });

  it("parses a Cookie header", () => {
    const jar = parseCookies("a=1; versen_session=x.y.z; b=2");
    expect(jar.get("versen_session")).toBe("x.y.z");
    expect(jar.get("missing")).toBeUndefined();
    expect(parseCookies(null).size).toBe(0);
  });
});

describe("audience separation and alg pinning", () => {
  const key = new TextEncoder().encode(SECRET);
  const now = Math.floor(Date.now() / 1000);
  const sessionFields = { email: "a@b.c", name: "N", sid: "s" };
  const oauthFields = { state: "s", nonce: "n", codeVerifier: "v", returnTo: "/" };
  const mint = (aud: string, fields: Record<string, unknown>, sub?: string) => {
    const jwt = new SignJWT(fields).setProtectedHeader({ alg: "HS256" }).setAudience(aud).setIssuedAt(now).setExpirationTime(now + 600);
    if (sub) jwt.setSubject(sub);
    return jwt.sign(key);
  };

  it("verifySession rejects an oauth-audience token even with a session-shaped payload", async () => {
    expect(await verifySession(SECRET, await mint("versen-oauth", { ...sessionFields, ...oauthFields }, "user-1"))).toBeNull();
  });

  it("verifyOauthCookie rejects a session-audience token even with an oauth-shaped payload", async () => {
    expect(await verifyOauthCookie(SECRET, await mint("versen-session", { ...sessionFields, ...oauthFields }, "user-1"))).toBeNull();
  });

  it("rejects alg:none and HS512 tokens in both verifiers", async () => {
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const claims = { sub: "user-1", iat: now, exp: now + 600, ...sessionFields, ...oauthFields };
    const none = (aud: string) => `${b64({ alg: "none", typ: "JWT" })}.${b64({ ...claims, aud })}.`;
    const hs512 = (aud: string) =>
      new SignJWT(claims).setProtectedHeader({ alg: "HS512" }).setAudience(aud).sign(key);
    expect(await verifySession(SECRET, none("versen-session"))).toBeNull();
    expect(await verifyOauthCookie(SECRET, none("versen-oauth"))).toBeNull();
    expect(await verifySession(SECRET, await hs512("versen-session"))).toBeNull();
    expect(await verifyOauthCookie(SECRET, await hs512("versen-oauth"))).toBeNull();
  });
});
