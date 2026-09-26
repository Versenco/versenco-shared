import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeProvider } from "./fake-provider";

let provider: FakeProvider;
beforeEach(async () => {
  provider = await FakeProvider.start({ clientId: "app", clientSecret: "secret", redirectUri: "http://localhost:3000/cb" });
});
afterEach(() => provider.stop());

describe("FakeProvider", () => {
  it("serves discovery and JWKS", async () => {
    const discovery = await (await fetch(`${provider.issuer}/.well-known/openid-configuration`)).json();
    expect(discovery.issuer).toBe(provider.issuer);
    expect(discovery.id_token_signing_alg_values_supported).toEqual(["RS256"]);
    const jwks = await (await fetch(discovery.jwks_uri)).json();
    expect(jwks.keys[0]).toMatchObject({ kty: "RSA", alg: "RS256", use: "sig", kid: "fake-key-1" });
  });

  it("authorize() refuses an unregistered redirect_uri", () => {
    const url = new URL(`${provider.issuer}/authorize`);
    url.searchParams.set("client_id", "app");
    url.searchParams.set("redirect_uri", "http://evil.example/cb");
    url.searchParams.set("code_challenge_method", "S256");
    expect(() => provider.authorize(url.href)).toThrow(/redirect_uri/);
  });

  it("rejects a token request with a bad client secret", async () => {
    const res = await fetch(`${provider.issuer}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", client_id: "app", client_secret: "wrong", code: "x" }),
    });
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("unauthorized_client");
  });
});
