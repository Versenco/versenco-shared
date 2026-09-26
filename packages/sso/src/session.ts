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

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

export function signSession(secret: string, data: SessionData, ttlSeconds: number, nowMs = Date.now()): Promise<string> {
  return sign(secret, { email: data.email, name: data.name, sid: data.sid, idt: data.idToken }, SESSION_AUDIENCE, ttlSeconds, nowMs, data.sub);
}

export async function verifySession(secret: string, token: string): Promise<Session | null> {
  const p = await verify(secret, token, SESSION_AUDIENCE);
  if (!p || typeof p.sub !== "string" || typeof p.iat !== "number" || typeof p.exp !== "number") return null;
  return {
    sub: p.sub,
    email: str(p.email),
    name: str(p.name),
    sid: str(p.sid),
    idToken: str(p.idt),
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
