import { describe, expect, it } from "vitest";
import { assertSessionSecret, resolveConfig } from "./config";
import { SsoError } from "./errors";

const valid = {
  issuer: "https://auth.versenco.com",
  clientId: "app",
  clientSecret: "secret",
  redirectUri: "https://app.example.com/auth/callback",
};

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err) {
    return err instanceof SsoError ? err.code : "not-an-SsoError";
  }
  return undefined;
}

describe("resolveConfig", () => {
  it("applies default scopes", () => {
    expect(resolveConfig(valid).scopes).toEqual(["openid", "profile", "email"]);
  });

  it("strips trailing slashes from the issuer (Review Focus 5)", () => {
    expect(resolveConfig({ ...valid, issuer: "https://auth.versenco.com/" }).issuer).toBe("https://auth.versenco.com");
  });

  it("allows http on loopback only", () => {
    expect(codeOf(() => resolveConfig({ ...valid, issuer: "http://localhost:9000", redirectUri: "http://localhost:3000/cb" }))).toBeUndefined();
    expect(codeOf(() => resolveConfig({ ...valid, issuer: "http://auth.versenco.com" }))).toBe("config_invalid");
    expect(codeOf(() => resolveConfig({ ...valid, redirectUri: "http://app.example.com/cb" }))).toBe("config_invalid");
  });

  it.each([
    ["issuer", { issuer: "not a url" }],
    ["redirectUri", { redirectUri: "/relative" }],
    ["clientId", { clientId: "  " }],
    ["clientSecret", { clientSecret: "" }],
    ["scopes without openid", { scopes: ["profile"] }],
  ])("rejects an invalid %s", (_name, patch) => {
    expect(codeOf(() => resolveConfig({ ...valid, ...patch }))).toBe("config_invalid");
  });
});

describe("assertSessionSecret", () => {
  it("rejects secrets shorter than 32 bytes", () => {
    expect(codeOf(() => assertSessionSecret("short"))).toBe("config_invalid");
    expect(codeOf(() => assertSessionSecret("x".repeat(31)))).toBe("config_invalid");
  });

  it("accepts 32 bytes or more", () => {
    expect(codeOf(() => assertSessionSecret("x".repeat(32)))).toBeUndefined();
  });

  it("counts bytes, not characters", () => {
    // 16 two-byte characters = 32 bytes
    expect(codeOf(() => assertSessionSecret("é".repeat(16)))).toBeUndefined();
  });
});
