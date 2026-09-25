# @versenco/sso Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and stage for release `@versenco/sso`, an npm package that adds "Sign in with Versenco" (OIDC Authorization Code + PKCE) to an app through a framework-free core and a Next.js 16 adapter.

**Architecture:** One package with two entry points. `@versenco/sso` (core) wraps `oauth4webapi` and discovers endpoints from `/.well-known/openid-configuration`. `@versenco/sso/next` adds route handlers and a stateless signed-cookie session built on `jose`. All tests run against a local fake OIDC provider (`node:http` + a `jose` key pair), so the attacks the real-login prototype never launched (tampered state, replayed code, forged signature) are covered.

**Tech Stack:** TypeScript 5, tsup (ESM + CJS + d.ts), Vitest 2, `oauth4webapi` 3.x, `jose` 6.x, Next.js 16 (optional peer), pnpm workspace.

**Spec:** `docs/superpowers/specs/2026-09-25-sso-design.md` (in this repo). Read it before starting.

## Global Constraints

- Package: `@versenco/sso`, public on npm, MIT, in `packages/sso/`, same conventions as `packages/vcoin-client/` (tsup, Vitest, `"type": "module"`).
- **pnpm only, never npm**, for install/run/test (npm is used only inside the release workflow, as in vcoin-client).
- Runtime deps: `oauth4webapi` `^3.8.8` and `jose` `^6.2.12`, nothing else. `next` is an **optional peer** (`>=16`); the core must import without `next` installed.
- No hand-written cryptography. PKCE, state, nonce, JWT signing and verification come from `oauth4webapi` / `jose`.
- Client authentication: `client_secret_post`. PKCE method: `S256`. Default scopes: `openid profile email`.
- `issuer` and `redirectUri` must be `https`, except loopback (`localhost`, `127.0.0.1`, `[::1]`) which may be `http`.
- The `id_token` signature is **always** verified via JWKS (`validateApplicationLevelSignature`), even though the library makes it optional.
- `validateApplicationLevelSignature` must receive the **same `Response` instance** that `processAuthorizationCodeResponse` processed (a clone taken once, passed to both), not a fresh clone.
- Session cookie: `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` unless the app runs on loopback http; absolute TTL 8 h (configurable), **no sliding expiry**. Login-state cookie: 10 minutes, deleted at callback.
- `sessionSecret` must be at least 32 bytes; a shorter one fails at startup with `config_invalid`.
- `returnTo` accepts same-origin relative paths only; anything else becomes `/`.
- Error messages never contain secrets or tokens.
- Stay within the vcoin-client style: small focused files, tests next to sources (`src/**/*.test.ts`).

## Review Focus

Failure modes the spec implies but a straight reading of the tasks would not test. Each has a test in the task named in brackets.

1. **Callback visited twice** (browser back button, double click): the second hit replays a used code and must end in a clean redirect to the error page, never a 500. [Task 5]
2. **Tricky `returnTo` values** (`//evil.com`, `/\evil.com`, `https://evil.com`, `javascript:`, control characters, `null`): all must collapse to `/`. [Task 4]
3. **Oversized session cookie** (long profile name inflates the `id_token` beyond the ~4 KB cookie limit): the session must still be created, without the `id_token` hint, instead of a silently dropped cookie. [Task 5]
4. **Clock skew** between the app host and the SSO: an `id_token` that expired a few seconds ago must be tolerated (30 s), while one that expired a minute ago must not. [Task 3]
5. **Issuer configured with a trailing slash** (`https://auth.versenco.com/`): must behave exactly like the version without it. [Task 3]

---

### Task 1: Package scaffold, errors, config validation

**Files:**
- Create: `packages/sso/package.json`, `packages/sso/tsconfig.json`, `packages/sso/tsup.config.ts`, `packages/sso/vitest.config.ts`, `packages/sso/LICENSE`, `packages/sso/CHANGELOG.md`
- Create: `packages/sso/src/errors.ts`, `packages/sso/src/config.ts`
- Test: `packages/sso/src/config.test.ts`

**Interfaces:**
- Produces (used by every later task):
  - `type SsoErrorCode = "config_invalid" | "discovery_failed" | "invalid_state" | "authorization_failed" | "token_exchange_failed" | "invalid_id_token" | "userinfo_failed" | "login_rejected"`
  - `class SsoError extends Error { readonly code: SsoErrorCode; constructor(code: SsoErrorCode, message: string, options?: { cause?: unknown }) }`
  - `interface SsoConfig { issuer: string; clientId: string; clientSecret: string; redirectUri: string; scopes?: string[] }`
  - `interface ResolvedSsoConfig { issuer: string; clientId: string; clientSecret: string; redirectUri: string; scopes: string[] }`
  - `function resolveConfig(config: SsoConfig): ResolvedSsoConfig` (throws `SsoError("config_invalid")`)
  - `function assertSessionSecret(secret: string): void` (throws `SsoError("config_invalid")`)

- [ ] **Step 1: Create the package files**

`packages/sso/package.json`:

```json
{
  "name": "@versenco/sso",
  "version": "0.1.0",
  "description": "Sign in with Versenco: OIDC client core and Next.js adapter for the Versenco SSO",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/Versenco/versenco-shared.git",
    "directory": "packages/sso"
  },
  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
      "require": { "types": "./dist/index.d.cts", "default": "./dist/index.cjs" }
    },
    "./next": {
      "import": { "types": "./dist/next.d.ts", "default": "./dist/next.js" },
      "require": { "types": "./dist/next.d.cts", "default": "./dist/next.cjs" }
    }
  },
  "typesVersions": { "*": { "next": ["./dist/next.d.ts"] } },
  "files": ["dist", "README.md", "LICENSE"],
  "publishConfig": { "access": "public" },
  "scripts": {
    "build": "tsup",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "jose": "^6.2.12",
    "oauth4webapi": "^3.8.8"
  },
  "peerDependencies": { "next": ">=16" },
  "peerDependenciesMeta": { "next": { "optional": true } },
  "devDependencies": {
    "next": "^16.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "tsup": "^8.3.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

`packages/sso/tsconfig.json` (ES2022 because `Error` `cause` needs it):

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM"],
    "strict": true,
    "declaration": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist"
  },
  "include": ["src"]
}
```

`packages/sso/tsup.config.ts`:

```ts
import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts", next: "src/next/index.ts" },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
});
```

`packages/sso/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

Copy the licence and start the changelog:

```bash
cd /home/sandwitch/Documents/GitHub/Versenco/versenco-shared
cp packages/vcoin-client/LICENSE packages/sso/LICENSE
printf '# Changelog\n\n## 0.1.0\n\n- Initial release: OIDC core (`@versenco/sso`) and Next.js 16 adapter (`@versenco/sso/next`).\n' > packages/sso/CHANGELOG.md
pnpm install
```

Expected: `pnpm install` completes; `packages/sso/node_modules` contains `oauth4webapi`, `jose`, `next`.

- [ ] **Step 2: Write the failing test**

`packages/sso/src/config.test.ts`:

```ts
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
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd packages/sso && pnpm test`
Expected: FAIL, `Cannot find module './config'` (or `./errors`).

- [ ] **Step 4: Write the implementation**

`packages/sso/src/errors.ts`:

```ts
export type SsoErrorCode =
  | "config_invalid"
  | "discovery_failed"
  | "invalid_state"
  | "authorization_failed"
  | "token_exchange_failed"
  | "invalid_id_token"
  | "userinfo_failed"
  | "login_rejected";

/** Every failure raised by this package. Messages never contain secrets or tokens. */
export class SsoError extends Error {
  readonly code: SsoErrorCode;

  constructor(code: SsoErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SsoError";
    this.code = code;
  }
}
```

`packages/sso/src/config.ts`:

```ts
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
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd packages/sso && pnpm test`
Expected: PASS, all `config.test.ts` tests green.

- [ ] **Step 6: Commit**

```bash
cd /home/sandwitch/Documents/GitHub/Versenco/versenco-shared
git add packages/sso pnpm-lock.yaml
git commit -m "feat(sso): scaffold @versenco/sso with errors and config validation" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Fake OIDC provider (test support)

**Files:**
- Create: `packages/sso/src/test-support/fake-provider.ts`
- Test: `packages/sso/src/test-support/fake-provider.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces (used by Tasks 3 and 5):
  - `class FakeProvider` with:
    - `static start(opts: { clientId: string; clientSecret: string; redirectUri: string }): Promise<FakeProvider>`
    - `stop(): Promise<void>`
    - `issuer: string` (`http://127.0.0.1:<port>`)
    - `overrides: TokenOverrides` (mutable, applied when the next token is minted)
    - `profile: { name: string }` (mutable)
    - `authorize(authUrl: string): URL` (simulates the browser leg, returns the callback URL with `code` and `state`)
  - `interface TokenOverrides { iss?: string; aud?: string; nonce?: string | null; expiresInSeconds?: number; signWith?: "rs256" | "other-key" | "hs256" | "none" }`
  - Fixed identity: `sub = "user-123"`, `email = "user@example.com"`, `sid = "sid-1"`. Endpoints: `/.well-known/openid-configuration`, `/authorize` (never called, only advertised), `/token`, `/jwks`, `/userinfo`, `/logout` (advertised as `end_session_endpoint`).

- [ ] **Step 1: Write the failing test**

`packages/sso/src/test-support/fake-provider.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/sso && pnpm test src/test-support`
Expected: FAIL, `Cannot find module './fake-provider'`.

- [ ] **Step 3: Write the implementation**

`packages/sso/src/test-support/fake-provider.ts`:

```ts
import { createHash, randomBytes } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { SignJWT, exportJWK, generateKeyPair, type JWK } from "jose";

export interface FakeProviderOptions {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface TokenOverrides {
  iss?: string;
  aud?: string;
  /** `null` omits the nonce claim; a string replaces it. */
  nonce?: string | null;
  /** Seconds until expiry; negative means already expired. Default 300. */
  expiresInSeconds?: number;
  signWith?: "rs256" | "other-key" | "hs256" | "none";
}

interface IssuedCode {
  nonce: string;
  challenge: string;
  redirectUri: string;
  used: boolean;
}

const SUB = "user-123";
const EMAIL = "user@example.com";
const b64url = (value: string) => Buffer.from(value).toString("base64url");

/** A minimal OIDC provider for tests: discovery, JWKS, token, userinfo. */
export class FakeProvider {
  overrides: TokenOverrides = {};
  profile = { name: "Test User" };
  issuer = "";

  private readonly kid = "fake-key-1";
  private readonly codes = new Map<string, IssuedCode>();
  private server!: http.Server;

  private constructor(
    private readonly opts: FakeProviderOptions,
    private readonly privateKey: CryptoKey,
    private readonly otherKey: CryptoKey,
    private readonly publicJwk: JWK,
  ) {}

  static async start(opts: FakeProviderOptions): Promise<FakeProvider> {
    const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
    const other = await generateKeyPair("RS256");
    const provider = new FakeProvider(opts, privateKey, other.privateKey, await exportJWK(publicKey));
    provider.server = http.createServer((req, res) => {
      provider.handle(req, res).catch(() => {
        res.writeHead(500).end();
      });
    });
    await new Promise<void>((resolve) => provider.server.listen(0, "127.0.0.1", resolve));
    provider.issuer = `http://127.0.0.1:${(provider.server.address() as AddressInfo).port}`;
    return provider;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  /** Simulates the user agreeing at /authorize: returns the callback URL the browser would land on. */
  authorize(authUrl: string): URL {
    const params = new URL(authUrl).searchParams;
    if (params.get("client_id") !== this.opts.clientId) throw new Error("unknown client_id");
    if (params.get("redirect_uri") !== this.opts.redirectUri) throw new Error("redirect_uri is not registered");
    if (params.get("code_challenge_method") !== "S256") throw new Error("PKCE S256 is required");

    const code = randomBytes(16).toString("hex");
    this.codes.set(code, {
      nonce: params.get("nonce") ?? "",
      challenge: params.get("code_challenge") ?? "",
      redirectUri: this.opts.redirectUri,
      used: false,
    });
    const callback = new URL(this.opts.redirectUri);
    callback.searchParams.set("code", code);
    const state = params.get("state");
    if (state) callback.searchParams.set("state", state);
    return callback;
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", this.issuer);
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };

    if (url.pathname === "/.well-known/openid-configuration") {
      return json(200, {
        issuer: this.issuer,
        authorization_endpoint: `${this.issuer}/authorize`,
        token_endpoint: `${this.issuer}/token`,
        userinfo_endpoint: `${this.issuer}/userinfo`,
        jwks_uri: `${this.issuer}/jwks`,
        end_session_endpoint: `${this.issuer}/logout`,
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["client_secret_post"],
      });
    }
    if (url.pathname === "/jwks") {
      return json(200, { keys: [{ ...this.publicJwk, kid: this.kid, alg: "RS256", use: "sig" }] });
    }
    if (url.pathname === "/token" && req.method === "POST") return this.token(req, json);
    if (url.pathname === "/userinfo") {
      if (!req.headers.authorization?.startsWith("Bearer at-")) return json(401, { error: "invalid_token" });
      return json(200, { sub: SUB, email: EMAIL, email_verified: true, name: this.profile.name });
    }
    return json(404, { error: "not_found" });
  }

  private async token(req: http.IncomingMessage, json: (status: number, body: unknown) => void): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const form = new URLSearchParams(Buffer.concat(chunks).toString());

    if (form.get("client_id") !== this.opts.clientId || form.get("client_secret") !== this.opts.clientSecret) {
      return json(401, { error: "unauthorized_client", error_description: "Client authentication failed" });
    }
    const code = form.get("code") ?? "";
    const issued = this.codes.get(code);
    const challenge = createHash("sha256").update(form.get("code_verifier") ?? "").digest("base64url");
    if (!issued || issued.used || issued.challenge !== challenge || issued.redirectUri !== form.get("redirect_uri")) {
      return json(400, { error: "invalid_grant" });
    }
    issued.used = true;
    return json(200, {
      access_token: `at-${code}`,
      token_type: "Bearer",
      expires_in: 3600,
      scope: "openid profile email",
      id_token: await this.mintIdToken(issued.nonce),
    });
  }

  private async mintIdToken(nonce: string): Promise<string> {
    const o = this.overrides;
    const now = Math.floor(Date.now() / 1000);
    const claims: Record<string, unknown> = {
      iss: o.iss ?? this.issuer,
      aud: o.aud ?? this.opts.clientId,
      sub: SUB,
      email: EMAIL,
      email_verified: true,
      name: this.profile.name,
      sid: "sid-1",
      jti: randomBytes(8).toString("hex"),
      iat: now,
      exp: now + (o.expiresInSeconds ?? 300),
    };
    if (o.nonce !== null) claims.nonce = o.nonce ?? nonce;

    const jwt = new SignJWT(claims);
    switch (o.signWith ?? "rs256") {
      case "rs256":
        return jwt.setProtectedHeader({ alg: "RS256", kid: this.kid }).sign(this.privateKey);
      case "other-key":
        return jwt.setProtectedHeader({ alg: "RS256", kid: this.kid }).sign(this.otherKey);
      case "hs256":
        return jwt
          .setProtectedHeader({ alg: "HS256", kid: this.kid })
          .sign(new TextEncoder().encode("attacker-controlled-secret-0123456789"));
      case "none":
        return `${b64url(JSON.stringify({ alg: "none" }))}.${b64url(JSON.stringify(claims))}.`;
    }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/sso && pnpm test src/test-support`
Expected: PASS, 3 tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/sso/src/test-support
git commit -m "test(sso): add fake OIDC provider for attack-path tests" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Core (`createSso`) with attack tests

**Files:**
- Create: `packages/sso/src/core.ts`, `packages/sso/src/index.ts`
- Test: `packages/sso/src/core.test.ts`

**Interfaces:**
- Consumes: `SsoError`, `SsoConfig`, `resolveConfig` (Task 1); `FakeProvider` (Task 2).
- Produces (used by Tasks 5 and 6):
  - `interface AuthorizationRequest { url: string; state: string; nonce: string; codeVerifier: string }`
  - `interface CallbackChecks { state: string; nonce: string; codeVerifier: string }`
  - `interface IdentityClaims { sub: string; email?: string; email_verified?: boolean; name?: string; sid?: string; iat: number; exp: number }`
  - `interface LoginResult { claims: IdentityClaims; accessToken: string; idToken: string }`
  - `interface UserInfo { sub: string; email?: string; email_verified?: boolean; name?: string }`
  - `interface Sso { authorizationUrl(): Promise<AuthorizationRequest>; handleCallback(callbackUrl: string | URL, checks: CallbackChecks): Promise<LoginResult>; userInfo(accessToken: string, expectedSub: string): Promise<UserInfo>; endSessionUrl(o: { idTokenHint?: string; postLogoutRedirectUri?: string }): Promise<string | null> }`
  - `function createSso(config: SsoConfig): Sso`
  - `src/index.ts` re-exports `createSso`, `SsoError`, and all the types above plus `SsoConfig`, `SsoErrorCode`.

- [ ] **Step 1: Write the failing tests**

`packages/sso/src/core.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/sso && pnpm test src/core.test.ts`
Expected: FAIL, `Cannot find module './index'`.

- [ ] **Step 3: Write the implementation**

`packages/sso/src/core.ts`:

```ts
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

const DISCOVERY_TTL_MS = 60 * 60 * 1000;
const CLOCK_SKEW_SECONDS = 30;

export function createSso(input: SsoConfig): Sso {
  const config = resolveConfig(input);
  const issuer = new URL(config.issuer);
  // Plain http is only reachable for loopback issuers (enforced by resolveConfig).
  const http = issuer.protocol === "http:" ? { [oauth.allowInsecureRequests]: true } : {};
  const client: oauth.Client = { client_id: config.clientId, [oauth.clockSkew]: CLOCK_SKEW_SECONDS };
  const clientAuth = oauth.ClientSecretPost(config.clientSecret);

  let cached: { at: number; server: Promise<oauth.AuthorizationServer> } | undefined;

  function discover(): Promise<oauth.AuthorizationServer> {
    if (cached && Date.now() - cached.at < DISCOVERY_TTL_MS) return cached.server;
    const server = (async () => {
      const response = await oauth.discoveryRequest(issuer, { algorithm: "oidc", ...http });
      return oauth.processDiscoveryResponse(issuer, response);
    })().catch((cause) => {
      cached = undefined;
      throw new SsoError("discovery_failed", "Could not load the OpenID configuration of the issuer", { cause });
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
      const url = new URL(server.authorization_endpoint!);
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
          throw new SsoError("authorization_failed", "The provider returned an authorization error", { cause });
        }
        throw new SsoError("invalid_state", "The authorization response is invalid", { cause });
      }

      let response: Response;
      try {
        response = await oauth.authorizationCodeGrantRequest(
          server, client, clientAuth, params, config.redirectUri, checks.codeVerifier, http,
        );
      } catch (cause) {
        throw new SsoError("token_exchange_failed", "The token request failed", { cause });
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
        if (cause instanceof oauth.ResponseBodyError || cause instanceof oauth.WWWAuthenticateChallengeError) {
          throw new SsoError("token_exchange_failed", "The token endpoint rejected the request", { cause });
        }
        throw new SsoError("invalid_id_token", "The id_token failed validation", { cause });
      }

      // oauth4webapi treats signature checking as optional (it trusts TLS); we always do it.
      try {
        await oauth.validateApplicationLevelSignature(server, processed, http);
      } catch (cause) {
        throw new SsoError("invalid_id_token", "The id_token signature could not be verified", { cause });
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
        throw new SsoError("userinfo_failed", "Could not fetch the user profile", { cause });
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
```

`packages/sso/src/index.ts`:

```ts
export { createSso } from "./core";
export type {
  AuthorizationRequest,
  CallbackChecks,
  IdentityClaims,
  LoginResult,
  Sso,
  UserInfo,
} from "./core";
export type { SsoConfig } from "./config";
export { SsoError } from "./errors";
export type { SsoErrorCode } from "./errors";
```

- [ ] **Step 4: Run the tests and typecheck**

Run: `cd packages/sso && pnpm test src/core.test.ts && pnpm exec tsc --noEmit`
Expected: PASS, every `core.test.ts` test green; `tsc` prints nothing.

If `tsc` rejects `[oauth.clockSkew]` on `oauth.Client`, run `grep -n "\[clockSkew\]" node_modules/oauth4webapi/build/index.d.ts` and move the option to the interface that declares it (the skew test in Step 4 proves it is applied). If one attack test unexpectedly passes the wrong way (a forgery accepted), **stop and report it**: that is a security finding, not a test to loosen.

- [ ] **Step 5: Commit**

```bash
git add packages/sso/src/core.ts packages/sso/src/core.test.ts packages/sso/src/index.ts
git commit -m "feat(sso): OIDC core with PKCE, id_token and signature verification" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Session and cookie primitives

**Files:**
- Create: `packages/sso/src/session.ts`
- Test: `packages/sso/src/session.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces (used by Tasks 5 and 6):
  - `interface SessionData { sub: string; email?: string; name?: string; sid?: string; idToken?: string }`
  - `interface Session extends SessionData { iat: number; exp: number }`
  - `interface OauthCookieData { state: string; nonce: string; codeVerifier: string; returnTo: string }`
  - `signSession(secret: string, data: SessionData, ttlSeconds: number, nowMs?: number): Promise<string>`
  - `verifySession(secret: string, token: string): Promise<Session | null>`
  - `signOauthCookie(secret: string, data: OauthCookieData, ttlSeconds?: number, nowMs?: number): Promise<string>` (default TTL 600)
  - `verifyOauthCookie(secret: string, token: string): Promise<OauthCookieData | null>`
  - `safeReturnTo(value: string | null | undefined): string`
  - `serializeCookie(name: string, value: string, o: { maxAge: number; secure: boolean }): string`
  - `clearCookie(name: string, secure: boolean): string`
  - `parseCookies(header: string | null): Map<string, string>`

- [ ] **Step 1: Write the failing tests**

`packages/sso/src/session.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/sso && pnpm test src/session.test.ts`
Expected: FAIL, `Cannot find module './session'`.

- [ ] **Step 3: Write the implementation**

`packages/sso/src/session.ts`:

```ts
import { SignJWT, jwtVerify } from "jose";

const encoder = new TextEncoder();
const SESSION_AUDIENCE = "versen-session";
const OAUTH_AUDIENCE = "versen-oauth";

export interface SessionData {
  sub: string;
  email?: string;
  name?: string;
  sid?: string;
  /** Kept so logout can pass id_token_hint; dropped when it would overflow the cookie. */
  idToken?: string;
}

export interface Session extends SessionData {
  iat: number;
  exp: number;
}

export interface OauthCookieData {
  state: string;
  nonce: string;
  codeVerifier: string;
  returnTo: string;
}

async function sign(
  secret: string,
  payload: Record<string, unknown>,
  audience: string,
  ttlSeconds: number,
  nowMs: number,
  subject?: string,
): Promise<string> {
  const iat = Math.floor(nowMs / 1000);
  const jwt = new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setAudience(audience)
    .setIssuedAt(iat)
    .setExpirationTime(iat + ttlSeconds);
  if (subject) jwt.setSubject(subject);
  return jwt.sign(encoder.encode(secret));
}

async function verify(secret: string, token: string, audience: string) {
  try {
    const { payload } = await jwtVerify(token, encoder.encode(secret), { algorithms: ["HS256"], audience });
    return payload;
  } catch {
    return null;
  }
}

export function signSession(secret: string, data: SessionData, ttlSeconds: number, nowMs = Date.now()): Promise<string> {
  return sign(secret, { email: data.email, name: data.name, sid: data.sid, idt: data.idToken }, SESSION_AUDIENCE, ttlSeconds, nowMs, data.sub);
}

export async function verifySession(secret: string, token: string): Promise<Session | null> {
  const p = await verify(secret, token, SESSION_AUDIENCE);
  if (!p || typeof p.sub !== "string" || typeof p.iat !== "number" || typeof p.exp !== "number") return null;
  return {
    sub: p.sub,
    email: p.email as string | undefined,
    name: p.name as string | undefined,
    sid: p.sid as string | undefined,
    idToken: p.idt as string | undefined,
    iat: p.iat,
    exp: p.exp,
  };
}

export function signOauthCookie(secret: string, data: OauthCookieData, ttlSeconds = 600, nowMs = Date.now()): Promise<string> {
  return sign(secret, { ...data }, OAUTH_AUDIENCE, ttlSeconds, nowMs);
}

export async function verifyOauthCookie(secret: string, token: string): Promise<OauthCookieData | null> {
  const p = await verify(secret, token, OAUTH_AUDIENCE);
  if (!p) return null;
  const { state, nonce, codeVerifier, returnTo } = p as Record<string, unknown>;
  if (![state, nonce, codeVerifier, returnTo].every((v) => typeof v === "string")) return null;
  return { state, nonce, codeVerifier, returnTo } as OauthCookieData;
}

/** Same-origin relative paths only; anything else collapses to "/". */
export function safeReturnTo(value: string | null | undefined): string {
  if (typeof value !== "string") return "/";
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return "/";
  if (/[\u0000-\u001f\u007f]/.test(value)) return "/";
  try {
    if (new URL(value, "http://local.invalid").origin !== "http://local.invalid") return "/";
  } catch {
    return "/";
  }
  return value;
}

export function serializeCookie(name: string, value: string, o: { maxAge: number; secure: boolean }): string {
  const parts = [`${name}=${value}`, "Path=/", `Max-Age=${o.maxAge}`, "HttpOnly", "SameSite=Lax"];
  if (o.secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearCookie(name: string, secure: boolean): string {
  return serializeCookie(name, "", { maxAge: 0, secure });
}

export function parseCookies(header: string | null): Map<string, string> {
  const jar = new Map<string, string>();
  for (const part of (header ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    jar.set(part.slice(0, index).trim(), part.slice(index + 1).trim());
  }
  return jar;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/sso && pnpm test src/session.test.ts && pnpm exec tsc --noEmit`
Expected: PASS, all green; `tsc` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add packages/sso/src/session.ts packages/sso/src/session.test.ts
git commit -m "feat(sso): signed session and login-state cookies, safe returnTo" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Next.js adapter, route handlers

**Files:**
- Create: `packages/sso/src/next/index.ts`
- Test: `packages/sso/src/next/handlers.test.ts`

**Interfaces:**
- Consumes: `createSso`, `Sso`, `IdentityClaims` (Task 3); `SsoError`, `assertSessionSecret`, `SsoConfig` (Task 1); all session/cookie helpers (Task 4); `FakeProvider` (Task 2).
- Produces (used by Task 6):
  - `interface NextSsoOptions extends SsoConfig { sessionSecret: string; sessionTtlSeconds?: number; cookiePrefix?: string; loginPath?: string; errorPath?: string; defaultReturnTo?: string; postLogoutRedirectUri?: string; onLogin?: (claims: IdentityClaims) => void | Promise<void> }` (defaults: TTL `28800`, prefix `"versen"`, loginPath `"/auth/login"`, errorPath `"/auth/error"`, defaultReturnTo `"/"`)
  - `function createNextSso(options: NextSsoOptions): { sso: Sso; handlers: { login(req: Request): Promise<Response>; callback(req: Request): Promise<Response>; logout(req: Request): Promise<Response> }; cookieNames: { session: string; oauth: string } }`
  - Task 6 adds `getSession`, `requireSession`, `getSessionFromRequest` to the same returned object.

- [ ] **Step 1: Write the failing tests**

`packages/sso/src/next/handlers.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/sso && pnpm test src/next/handlers.test.ts`
Expected: FAIL, `Cannot find module './index'`.

- [ ] **Step 3: Write the implementation**

`packages/sso/src/next/index.ts`:

```ts
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
} from "../session";

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
  const sso: Sso = createSso(options);
  const secret = options.sessionSecret;
  const prefix = options.cookiePrefix ?? "versen";
  const cookieNames = { session: `${prefix}_session`, oauth: `${prefix}_oauth` };
  const ttl = options.sessionTtlSeconds ?? 8 * 60 * 60;
  const appUrl = new URL(options.redirectUri);
  const secure = appUrl.protocol === "https:";
  const errorPath = options.errorPath ?? "/auth/error";
  const home = options.defaultReturnTo ?? "/";

  function redirectTo(target: string, cookies: string[] = []): Response {
    const headers = new Headers({ location: new URL(target, appUrl).href, "cache-control": "no-store" });
    for (const cookie of cookies) headers.append("set-cookie", cookie);
    return new Response(null, { status: 302, headers });
  }

  function fail(error: SsoError, cookies: string[] = []): Response {
    return redirectTo(`${errorPath}?code=${error.code}`, cookies);
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

  return { sso, handlers, cookieNames };
}

export type { IdentityClaims } from "../core";
export { SsoError } from "../errors";
export type { SsoErrorCode } from "../errors";
export type { Session } from "../session";
```

- [ ] **Step 4: Run the tests and typecheck**

Run: `cd packages/sso && pnpm test src/next/handlers.test.ts && pnpm exec tsc --noEmit`
Expected: PASS, all handler tests green; `tsc` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add packages/sso/src/next
git commit -m "feat(sso): Next.js route handlers with signed-cookie session" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Session readers (`getSession`, `requireSession`, `getSessionFromRequest`)

**Files:**
- Modify: `packages/sso/src/next/index.ts` (imports, and the object returned by `createNextSso`)
- Test: `packages/sso/src/next/session-readers.test.ts`

**Interfaces:**
- Consumes: `createNextSso`, `cookieNames`, `Session`, `verifySession`, `safeReturnTo` (Tasks 4, 5); `cookies` from `next/headers`, `redirect` from `next/navigation`.
- Produces: the object returned by `createNextSso` gains:
  - `getSession(): Promise<Session | null>` (Server Components, Server Actions, route handlers)
  - `requireSession(returnTo?: string): Promise<Session>` (redirects to `loginPath`, with `?returnTo=` when given)
  - `getSessionFromRequest(req: Request): Promise<Session | null>` (for `proxy.ts`, where `cookies()` from `next/headers` is not available)

- [ ] **Step 1: Write the failing tests**

`packages/sso/src/next/session-readers.test.ts`:

```ts
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
    await expect(app.requireSession("//evil.com")).rejects.toThrow("NEXT_REDIRECT:/auth/login?returnTo=%2F");
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/sso && pnpm test src/next/session-readers.test.ts`
Expected: FAIL, `app.getSession is not a function`.

- [ ] **Step 3: Write the implementation**

In `packages/sso/src/next/index.ts`, add two imports at the top of the file:

```ts
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
```

Add `type Session` to the existing `../session` import block so it reads:

```ts
import {
  clearCookie,
  parseCookies,
  safeReturnTo,
  serializeCookie,
  signOauthCookie,
  signSession,
  verifyOauthCookie,
  verifySession,
  type Session,
} from "../session";
```

Then replace the final `return { sso, handlers, cookieNames };` line of `createNextSso` with:

```ts
  const loginPath = options.loginPath ?? "/auth/login";

  async function getSession(): Promise<Session | null> {
    const raw = (await cookies()).get(cookieNames.session)?.value;
    return raw ? verifySession(secret, raw) : null;
  }

  async function requireSession(returnTo?: string): Promise<Session> {
    const session = await getSession();
    if (session) return session;
    redirect(returnTo === undefined ? loginPath : `${loginPath}?returnTo=${encodeURIComponent(safeReturnTo(returnTo))}`);
  }

  /** For proxy.ts, where `cookies()` from next/headers is unavailable. */
  async function getSessionFromRequest(req: Request): Promise<Session | null> {
    const raw = parseCookies(req.headers.get("cookie")).get(cookieNames.session);
    return raw ? verifySession(secret, raw) : null;
  }

  return { sso, handlers, cookieNames, getSession, requireSession, getSessionFromRequest };
```

- [ ] **Step 4: Run the whole suite and typecheck**

Run: `cd packages/sso && pnpm test && pnpm exec tsc --noEmit`
Expected: PASS, every test in the package green (config, fake provider, core, session, handlers, session-readers); `tsc` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add packages/sso/src/next
git commit -m "feat(sso): getSession, requireSession and getSessionFromRequest" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: Build, README, release workflow

**Files:**
- Create: `packages/sso/README.md`, `.github/workflows/sso-publish.yml`
- Modify: `packages/sso/CHANGELOG.md` (only if the version changes)
- Verify: `packages/sso/dist/*`

**Interfaces:**
- Consumes: everything from Tasks 1 to 6.
- Produces: a built package whose two entry points load under ESM and CJS, and a tag-triggered workflow that only **stages** the release.

- [ ] **Step 1: Build and check both entry points load**

Run:

```bash
cd packages/sso && pnpm build && ls dist
```

Expected files: `index.js index.cjs index.d.ts index.d.cts next.js next.cjs next.d.ts next.d.cts` (plus `.map` files, and possibly shared `chunk-*.js` files that tsup emits for the ESM build).

Then prove the core does not need Next installed and both formats load:

```bash
cd packages/sso
node -e 'const m=require("./dist/index.cjs"); console.log("cjs core:", typeof m.createSso, typeof m.SsoError)'
node --input-type=module -e 'import("./dist/index.js").then(m=>console.log("esm core:", typeof m.createSso))'
node --input-type=module -e 'import("./dist/next.js").then(m=>console.log("esm next:", typeof m.createNextSso))'
grep -c "from \"next" dist/index.js dist/index.cjs
```

Expected: `cjs core: function function`, `esm core: function`, `esm next: function`, and the `grep -c` prints `0` for both core files (the core bundle must not reference `next`).

- [ ] **Step 2: Write the README**

`packages/sso/README.md`:

````markdown
# @versenco/sso

Sign in with Versenco: an OpenID Connect client for the Versenco SSO (`auth.versenco.com`), with a framework-free core and a Next.js 16 adapter.

- Authorization Code flow with PKCE (S256), `client_secret_post`
- The `id_token` signature is always verified against the provider's JWKS
- Endpoints are discovered from `/.well-known/openid-configuration`, nothing to hard-code
- Stateless sessions in a signed `HttpOnly` cookie: no database on your side

> **Access is by registration.** Publishing this package does not open the SSO to everyone: a Versenco admin registers your app and gives you a `client_id`, a `client_secret` and registers your exact callback URL.

## Install

```bash
pnpm add @versenco/sso
```

## Next.js 16

```ts
// lib/sso.ts  (server-only)
import { createNextSso } from "@versenco/sso/next";

export const { handlers, getSession, requireSession, getSessionFromRequest } = createNextSso({
  issuer: "https://auth.versenco.com",
  clientId: process.env.VERSEN_CLIENT_ID!,
  clientSecret: process.env.VERSEN_CLIENT_SECRET!,
  redirectUri: "https://app.example.com/auth/callback",
  sessionSecret: process.env.SESSION_SECRET!, // at least 32 bytes, e.g. `openssl rand -base64 32`
  // Create or update your own user record. Throwing aborts the sign-in.
  onLogin: async (claims) => {
    await db.user.upsert({ where: { ssoId: claims.sub }, update: {}, create: { ssoId: claims.sub, email: claims.email } });
  },
});
```

Mount the three handlers:

```ts
// app/auth/login/route.ts
import { handlers } from "@/lib/sso";
export const GET = handlers.login;

// app/auth/callback/route.ts
import { handlers } from "@/lib/sso";
export const GET = handlers.callback;

// app/auth/logout/route.ts
import { handlers } from "@/lib/sso";
export const GET = handlers.logout;
```

Use the session in Server Components and route handlers:

```tsx
import { requireSession } from "@/lib/sso";

export default async function Page() {
  const session = await requireSession("/dashboard"); // redirects to /auth/login if signed out
  return <p>Hello {session.name}</p>;
}
```

Protect paths in `proxy.ts`:

```ts
import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/sso";

export async function proxy(request: Request) {
  if (!(await getSessionFromRequest(request))) {
    const url = new URL("/auth/login", request.url);
    url.searchParams.set("returnTo", new URL(request.url).pathname);
    return NextResponse.redirect(url);
  }
}
export const config = { matcher: ["/dashboard/:path*"] };
```

Failed sign-ins redirect to `/auth/error?code=<code>` (change with `errorPath`). Codes: `invalid_state`, `authorization_failed`, `token_exchange_failed`, `invalid_id_token`, `discovery_failed`, `login_rejected`.

### Options

| Option | Default | Notes |
|---|---|---|
| `sessionTtlSeconds` | `28800` (8 h) | Absolute lifetime, no sliding expiry: the SSO issues no refresh token, so an expired session re-runs `/authorize`, which is instant while the user is still signed in at the SSO |
| `cookiePrefix` | `"versen"` | Cookies are `<prefix>_session` and `<prefix>_oauth` |
| `loginPath` | `/auth/login` | Where `requireSession()` redirects |
| `errorPath` | `/auth/error` | |
| `defaultReturnTo` | `/` | `returnTo` accepts same-origin relative paths only |
| `postLogoutRedirectUri` | none | Must be registered on your SSO client |

`logout` clears the cookie then ends the SSO session. It accepts GET and POST.

## Core (any framework)

```ts
import { createSso } from "@versenco/sso";

const sso = createSso({ issuer, clientId, clientSecret, redirectUri });

const { url, state, nonce, codeVerifier } = await sso.authorizationUrl();
// Store state, nonce and codeVerifier in your own session, redirect the user to `url`.

const { claims, accessToken, idToken } = await sso.handleCallback(callbackUrl, { state, nonce, codeVerifier });
const profile = await sso.userInfo(accessToken, claims.sub);
const logoutUrl = await sso.endSessionUrl({ idTokenHint: idToken, postLogoutRedirectUri });
```

Every failure is an `SsoError` with a stable `code`. Messages never contain secrets or tokens.

## Security notes

- Keep `clientSecret` and `sessionSecret` server-side. Never expose them with a `NEXT_PUBLIC_` prefix.
- Rotating `sessionSecret` signs every user out.
- The session cookie carries the `id_token` (used as `id_token_hint` at logout). It is dropped automatically if it would push the cookie over the browser limit.

## License

MIT
````

- [ ] **Step 3: Create the release workflow from the vcoin-client one**

```bash
cd /home/sandwitch/Documents/GitHub/Versenco/versenco-shared
sed 's/vcoin-client/sso/g' .github/workflows/vcoin-client-publish.yml > .github/workflows/sso-publish.yml
grep -n "sso\|vcoin" .github/workflows/sso-publish.yml
```

Expected: every match mentions `sso` (`name: Publish sso`, tag `sso@*`, `--filter @versenco/sso`, `working-directory: packages/sso`, `npm stage list @versenco/sso`) and **no** line still says `vcoin`. If any `vcoin` remains, fix it by hand before continuing.

- [ ] **Step 4: Full verification before committing**

Run:

```bash
cd /home/sandwitch/Documents/GitHub/Versenco/versenco-shared
pnpm --filter @versenco/sso test
pnpm --filter @versenco/sso exec tsc --noEmit
pnpm --filter @versenco/sso build
```

Expected: all tests pass, `tsc` silent, build succeeds. Also confirm the tarball ships only what it should:

```bash
cd packages/sso && pnpm pack --dry-run 2>&1 | grep -E "dist/|README|LICENSE|package.json" | head -20
```

Expected: only `dist/`, `README.md`, `LICENSE`, `package.json`; **no** `src/`, no `test-support`, no `.env`.

- [ ] **Step 5: Commit**

```bash
git add packages/sso .github/workflows/sso-publish.yml
git commit -m "feat(sso): README and staged-release workflow for @versenco/sso" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Hand off the release to the maintainer (not automatable)**

Do **not** tag or publish. Tell the maintainer:

1. Before promoting the package to third parties, confirm the identity-provider prerequisites in spec §9 (C1 for the `authenticated` role, C6 on the deployed version, `JWT_PRIVATE_KEY_JWK` set in production so `sso-token` never falls back to HS256).
2. The **first publish of a new package name** is manual, as it was for `@versenco/vcoin-client`: check `packages/vcoin-client/CHANGELOG.md` and the git history for how `0.1.0` was released and repeat that.
3. Later versions: `git tag sso@0.1.1 && git push --tags` stages the release; approve it with 2FA via `npm stage list @versenco/sso` then `npm stage approve <stage-id> --otp <code>`.

---

## Out of scope for this plan

- The optional live integration test against the real `auth.versenco.com` (spec §6): a follow-up once a dedicated client exists.
- Migrating existing apps (sovereign-connect, codeben, VersenEducation) and wiring VersenAds as first consumer: separate plans.
- Back-channel logout, refresh tokens, public (secret-less) clients, other frameworks.

## Self-review notes

- **Spec coverage:** §2 package shape → Tasks 1, 7; §3 config, discovery, startup validation → Tasks 1, 3, 5; §4 core (URL, callback, userinfo, end-session, signature, same-Response pitfall) → Task 3; §5 adapter (routes, `onLogin`, cookie attributes, login-state cookie, `returnTo`, session readers, proxy helper, logout) → Tasks 4, 5, 6; §6 typed errors and attack tests → Tasks 1, 3, 4, 5; §7 distribution → Task 7; §9 provider prerequisites → Task 7 Step 6.
- **Deliberate deviations from the spec text** (spec updated to match): `sessionSecret` is an option of `createNextSso`, not of the core `createSso`, which has no sessions; `authorizationUrl()` takes no `returnTo` (the adapter stores it in the login-state cookie); the error page is set by `errorPath`, not an `onError` callback; the `withSession` helper is replaced by `getSessionFromRequest`; the session cookie also carries the `id_token` because `sso-end-session` needs `id_token_hint` (or a Bearer token) to identify the user to sign out; error codes are `discovery_failed`, `authorization_failed`, `userinfo_failed`, `login_rejected` (added) and `session_expired` (dropped: an expired session is simply "no session").
