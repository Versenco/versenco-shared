import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeProvider } from "../test-support/fake-provider";
import { signSession } from "../session";
import { createNextSso } from "./index";

const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined) }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));

const APP = "http://localhost:3000";
const SECRET = "a-test-secret-that-is-at-least-32-bytes-long";
let provider: FakeProvider;
let app: ReturnType<typeof createNextSso>;

beforeEach(async () => {
  jar.clear();
  provider = await FakeProvider.start({ clientId: "app", clientSecret: "secret", redirectUri: `${APP}/auth/callback` });
  app = createNextSso({
    issuer: provider.issuer,
    clientId: "app",
    clientSecret: "secret",
    redirectUri: `${APP}/auth/callback`,
    sessionSecret: SECRET,
  });
});
afterEach(() => provider.stop());

const validToken = () => signSession(SECRET, { sub: "user-123", email: "user@example.com" }, 3600);

describe("getSession", () => {
  it("returns null without a cookie", async () => {
    expect(await app.getSession()).toBeNull();
  });

  it("returns the session for a valid cookie", async () => {
    jar.set("versen_session", await validToken());
    expect(await app.getSession()).toMatchObject({ sub: "user-123", email: "user@example.com" });
  });

  it("returns null for an expired cookie", async () => {
    jar.set("versen_session", await signSession(SECRET, { sub: "user-123" }, 3600, Date.now() - 2 * 3600 * 1000));
    expect(await app.getSession()).toBeNull();
  });

  it("returns null for a cookie signed with another secret", async () => {
    jar.set("versen_session", await signSession("a-completely-different-32-byte-secret!!", { sub: "user-123" }, 3600));
    expect(await app.getSession()).toBeNull();
  });
});

describe("requireSession", () => {
  it("returns the session when signed in", async () => {
    jar.set("versen_session", await validToken());
    await expect(app.requireSession()).resolves.toMatchObject({ sub: "user-123" });
  });

  it("redirects anonymous visitors to the login path", async () => {
    await expect(app.requireSession()).rejects.toThrow("NEXT_REDIRECT:/auth/login");
  });

  it("carries a safe returnTo and drops an unsafe one", async () => {
    await expect(app.requireSession("/billing?tab=2")).rejects.toThrow("NEXT_REDIRECT:/auth/login?returnTo=%2Fbilling%3Ftab%3D2");
    await expect(app.requireSession("//evil.com")).rejects.toThrow(/^NEXT_REDIRECT:\/auth\/login\?returnTo=%2F$/);
  });
});

describe("getSessionFromRequest (for proxy.ts)", () => {
  it("reads the session from the Cookie header", async () => {
    const request = new Request(`${APP}/dashboard`, { headers: { cookie: `x=1; versen_session=${await validToken()}` } });
    expect(await app.getSessionFromRequest(request)).toMatchObject({ sub: "user-123" });
  });

  it("returns null without the cookie", async () => {
    expect(await app.getSessionFromRequest(new Request(`${APP}/dashboard`))).toBeNull();
  });
});

describe("id_token is never exposed", () => {
  const withIdt = () => signSession(SECRET, { sub: "user-123", idToken: "secret.id.token" }, 3600);

  it("getSession, requireSession and getSessionFromRequest omit idToken", async () => {
    const token = await withIdt();
    jar.set("versen_session", token);
    expect(await app.getSession()).not.toHaveProperty("idToken");
    expect(await app.requireSession()).not.toHaveProperty("idToken");
    const request = new Request(`${APP}/x`, { headers: { cookie: `versen_session=${token}` } });
    expect(await app.getSessionFromRequest(request)).not.toHaveProperty("idToken");
  });
});

describe("loginPath with a query string", () => {
  it("appends returnTo with &", async () => {
    const a = createNextSso({
      issuer: provider.issuer, clientId: "app", clientSecret: "secret",
      redirectUri: `${APP}/auth/callback`, sessionSecret: SECRET, loginPath: "/signin?ui=1",
    });
    await expect(a.requireSession("/x")).rejects.toThrow("NEXT_REDIRECT:/signin?ui=1&returnTo=%2Fx");
    await expect(a.requireSession()).rejects.toThrow("NEXT_REDIRECT:/signin?ui=1");
  });
});
