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
