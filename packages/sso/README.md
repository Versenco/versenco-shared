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
- The session cookie carries the `id_token` (used as `id_token_hint` at logout). It is dropped automatically if it would push the cookie over the browser limit. If the session is still over 3800 characters without the `id_token`, sign-in fails with `config_invalid`.
- Cookie names have no `__Host-` prefix (it would break `http://localhost` development). A sibling `*.versenco.com` subdomain could therefore plant a cookie with the same name; the effect is a sign-in failure or login CSRF, and a planted session is still rejected without a valid HMAC. Use a distinct `cookiePrefix` per app.
- Logout is a GET with no CSRF protection, so a cross-site page can sign a user out.
- The SSO issues no refresh token: the session is 8 h absolute.

## License

MIT
