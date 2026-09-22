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
  baseUrl: "https://auth.versenco.com",
});

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

const vcoin = createVCoinUserClient({ baseUrl: "https://auth.versenco.com" });

const balance = await vcoin.balance({ accessToken });
```

## Getting a `client_secret`

Server-side access is gated per app. Contact Versenco to register your app
and receive a `client_id` / `client_secret` pair.

## License

MIT
