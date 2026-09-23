# Changelog

## 0.2.0 — 2026-09-23

- Added `timeoutMs` to `createVCoinServerClient` and `createVCoinUserClient`.
  Requests now time out after 30 seconds by default (previously they could
  wait indefinitely) and throw a `VCoinNetworkError` on expiry. The timer
  also covers reading the response body. An invalid `timeoutMs` (zero,
  negative, `NaN`, `Infinity`) throws when the client is created.
- Added `"report_resolved"` to `EarnType`. The API only accepts it once the
  vCoin backend has been updated to allow it.
- A failure while reading the response body is now reported as a
  `VCoinNetworkError` instead of escaping as a raw error.

## 0.1.0 — 2026-09-22

Initial release.

- `createVCoinServerClient`: `earn`, `spend`, `refund`, `balance`, `getConfig`.
- `createVCoinUserClient`: `balance`, `verifyRecipient`, `transfer`, `createCheckout`.
- `idempotencyKey` helper.
- Full TypeScript types, no runtime dependencies.
