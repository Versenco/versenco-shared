# @versenco/vcoin-client

TypeScript client for Versenco's vCoin API — the shared in-app currency used
across the Versenco ecosystem (vChat, VersenEducation, versen-pay, and more).

Two entry points, matching the two trust domains of the underlying API:

- **`createVCoinServerClient`** — needs your app's `client_secret`. Runs
  **server-side only**. Grants and debits vCoins, issues refunds, reads any
  user's balance, reads platform config.
- **`createVCoinUserClient`** — no secret. Takes the *user's own*
  `accessToken` per call. Safe to use in the browser: reads the current
  user's balance, verifies/executes a peer-to-peer transfer, starts a top-up
  checkout.

## Install

```bash
pnpm add @versenco/vcoin-client
```

## Server usage

```ts
import { createVCoinServerClient, idempotencyKey } from "@versenco/vcoin-client";

const vcoin = createVCoinServerClient({
  appId: "your-app-id",
  clientSecret: process.env.VCOIN_CLIENT_SECRET!,
  baseUrl: "https://wnziizrtaocclnctqkll.supabase.co",
});
```

This is your versen-connect Supabase project's URL (not the `auth.versenco.com`
app domain, which only serves the login UI) — edge functions live at
`<supabase-project-url>/functions/v1/*`.

```ts
const result = await vcoin.earn({
  userId,
  amount: 50,
  type: "upload_reward",
  description: `Uploaded "${title}"`,
  referenceId: documentId,
  idempotencyKey: idempotencyKey("upload", documentId, userId),
});

if (!result.ok) {
  // result.error is a typed string; some errors (insufficient_balance,
  // insufficient_balance_for_refund, daily_limit_exceeded) carry extra fields.
  console.error(result.error);
} else if (result.data.idempotent) {
  // this exact idempotencyKey was already processed — nothing new happened.
} else {
  console.log(result.data.balance, result.data.transactionId);
}
```

## User usage (safe in the browser)

```ts
import { createVCoinUserClient } from "@versenco/vcoin-client";

const vcoin = createVCoinUserClient({ baseUrl: "https://wnziizrtaocclnctqkll.supabase.co" });

const balance = await vcoin.balance({ accessToken });
```

The `accessToken` is the access token from your app's own versen-connect SSO
session — not a vCoin-specific credential.

## Getting a `client_secret`

Server-side access is gated per app. Contact Versenco to register your app
and receive an app id / client secret pair (the `appId` / `clientSecret`
fields of `VCoinServerConfig`).

## All methods

**Server** (`createVCoinServerClient`, needs `clientSecret`):

- `earn(input)` — credit vCoins to a user; idempotent via `idempotencyKey`.
- `spend(input)` — debit vCoins from a user; idempotent via `idempotencyKey`.
- `refund(input)` — reverse a prior spend by transaction id.
- `balance(input)` — read any user's balance and recent transactions.
- `getConfig(key?)` — read platform config (e.g. the vCoin-to-XOF ratio).

**User** (`createVCoinUserClient`, no secret, takes `accessToken` per call):

- `balance(input)` — read the current user's own balance and transactions.
- `verifyRecipient(input)` — look up a transfer recipient before sending.
- `transfer(input)` — send vCoins to another user; requires an
  `idempotencyKey` (see the idempotency section below — always include your
  app id as one of the parts, since keys are unique across the whole vCoin
  system, not just your app).
- `createCheckout(input)` — start a vCoin top-up checkout session.

## Idempotency keys

`idempotencyKey(...)` builds a stable key from one or more parts. Keys are
unique across the ENTIRE vCoin system — all apps and all users share one
keyspace at the database level — so always include your own app id (or an
equally unique prefix) as one of the parts you pass in, to avoid colliding
with another app's key.

Whether you must pass one depends on the method: it is **optional** on
`earn` and `spend`, and **required** on `transfer` (the API rejects a
transfer without it). Optional does not mean harmless to skip — without a
key, a retried `earn` or `spend` (after a timeout, say) is applied twice.
Pass one for anything you might retry.

## Timeouts

Every request times out after 30 seconds by default. Set `timeoutMs` in
either client's config to change it; it must be a positive, finite number.
When it expires the call throws a `VCoinNetworkError`.

```ts
const vcoin = createVCoinServerClient({ appId, clientSecret, baseUrl, timeoutMs: 10_000 });
```

Note that a timeout says nothing about whether the server applied the
request — which is one more reason to send an `idempotencyKey` on `earn`
and `spend`.

## Errors

Two different failure shapes:

- A thrown `VCoinNetworkError` — unexpected failures: the network is down,
  the response isn't valid JSON, or the API returned something with no
  recognizable error code. Callers should generally let this propagate or
  wrap it in their own error handling.
- A returned `{ ok: false, error, ... }` — expected business outcomes:
  insufficient balance, wallet not found, daily limit exceeded, etc. These
  are part of the normal return type and should be handled inline.

```ts
try {
  const result = await vcoin.spend({ userId, amount: 10, type: "decoration" });
  if (!result.ok) {
    // expected business outcome, e.g. result.error === "insufficient_balance"
    console.error(result.error);
    return;
  }
  console.log(result.data.balance);
} catch (err) {
  // unexpected failure (network, malformed response, etc.)
  console.error(err);
}
```

## License

MIT
