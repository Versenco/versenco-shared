# @versenco/vcoin-client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `@versenco/vcoin-client` v0.1.0 — a public npm package with two structurally-separated clients (server-secret-gated and user-JWT-gated) that wrap every versen-connect `vcoin-*` edge function, replacing the copy-pasted `fetch` boilerplate described in `SSO/VCOIN_INTEGRATION.md`.

**Architecture:** A pnpm workspace (`versenco-shared`) holding one package today, ready for `sso-*`/`vcaptcha-*` packages later without restructuring. Inside the package: a generic HTTP layer (`fetcher.ts`) that never knows about vCoin business shapes, per-endpoint response mappers (`mappers.ts`) that convert the edge functions' actual snake_case JSON into the typed camelCase results, and two thin client factories (`server.ts`, `user.ts`) that only assemble requests. Published to public npm under the `@versenco` scope via CI on git tag push.

**Tech Stack:** TypeScript (strict), tsup (ESM+CJS+d.ts build), Vitest, pnpm workspaces, GitHub Actions + npm provenance for publish.

## Global Constraints

- **pnpm only**, never npm, for all package-manager commands.
- Every HTTP call goes through `fetcher.ts` — no direct `fetch()` calls anywhere else in `src/`.
- Wire format (request bodies sent to versen-connect, and its JSON responses) is **snake_case**; every public TypeScript type in this package is **camelCase**. The mapping happens only in `mappers.ts` (responses) and inline in `server.ts`/`user.ts` (requests) — never leak snake_case into a public type.
- No business-case exceptions. `VCoinNetworkError` is thrown only for genuinely unexpected failures (network, non-JSON, an error HTTP status with no recognizable `error` code). Every expected business outcome (insufficient balance, wallet not found, etc.) is a typed `{ ok: false, ... }` return value.
- `clientSecret` and `accessToken` are never logged, never put in a URL (always in a header), and covered by a dedicated test (Task 6).
- Every step that changes code shows complete code — no "add error handling" placeholders.
- Commit message trailer — end every commit body with:
  ```
  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  ```

---

## Task 0 (operator prerequisite — no code)

Before Task 6's publish workflow can succeed:

1. Create the `versenco` organization on npmjs.com (free for public packages) — reserves the `@versenco` scope for this and the future `sso`/`vcaptcha`/`ads` packages.
2. Generate an npm **Automation** token scoped to publish under `@versenco`.
3. Push this local repo to `github.com/<org>/versenco-shared` (it is git-initialized locally but has no remote yet).
4. Add the npm token as a GitHub Actions repository secret named `NPM_TOKEN`.

Tasks 1–6 do not depend on this being done first — the test suite mocks all network calls — but nothing publishes until it is.

---

## File Structure

```
versenco-shared/
  pnpm-workspace.yaml
  package.json
  .gitignore
  .github/workflows/vcoin-client-publish.yml
  packages/vcoin-client/
    package.json
    tsconfig.json
    tsup.config.ts
    vitest.config.ts
    LICENSE
    README.md
    CHANGELOG.md
    src/
      types.ts             # all public types + VCoinNetworkError
      idempotency.ts        # idempotencyKey() helper
      idempotency.test.ts
      fetcher.ts             # vcoinFetch(), functionUrl(), genericErrorResult()
      fetcher.test.ts
      mappers.ts               # per-endpoint response → typed result
      mappers.test.ts
      server.ts                  # createVCoinServerClient
      server.test.ts
      user.ts                     # createVCoinUserClient
      user.test.ts
      index.ts                     # public exports
      index.test.ts                 # secret-redaction + wire-contract tests
```

---

## Task 1: Workspace scaffold + package toolchain

**Files:**
- Create: `pnpm-workspace.yaml`, `package.json` (root), `.gitignore`, `packages/vcoin-client/package.json`, `packages/vcoin-client/tsconfig.json`, `packages/vcoin-client/tsup.config.ts`, `packages/vcoin-client/vitest.config.ts`, `packages/vcoin-client/src/index.ts`, `packages/vcoin-client/src/index.test.ts` (temporary content, extended in Task 6)

**Interfaces:**
- Consumes: nothing.
- Produces: a working `pnpm install` / `pnpm -r test` / `pnpm -r build` toolchain that every later task relies on. `src/index.ts` exports `export const VCOIN_CLIENT_VERSION = "0.1.0";` for now (real, checked constant — not a placeholder; it becomes one export among many in Task 6).

- [ ] **Step 1: Write `pnpm-workspace.yaml`**

```yaml
packages:
  - "packages/*"
```

- [ ] **Step 2: Write the root `package.json`**

```json
{
  "name": "versenco-shared",
  "private": true,
  "scripts": {
    "build": "pnpm -r build",
    "test": "pnpm -r test"
  }
}
```

- [ ] **Step 3: Write `.gitignore`**

```
node_modules/
dist/
*.log
.DS_Store
```

- [ ] **Step 4: Write `packages/vcoin-client/package.json`**

```json
{
  "name": "@versenco/vcoin-client",
  "version": "0.1.0",
  "description": "Server and user-session TypeScript client for Versenco's vCoin API",
  "license": "MIT",
  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    }
  },
  "files": ["dist", "README.md", "LICENSE"],
  "publishConfig": { "access": "public" },
  "scripts": {
    "build": "tsup",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "tsup": "^8.3.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 5: Write `packages/vcoin-client/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2020"],
    "strict": true,
    "declaration": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist"
  },
  "include": ["src"]
}
```

- [ ] **Step 6: Write `packages/vcoin-client/tsup.config.ts`**

```ts
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
});
```

- [ ] **Step 7: Write `packages/vcoin-client/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

- [ ] **Step 8: Write `packages/vcoin-client/src/index.ts`**

```ts
export const VCOIN_CLIENT_VERSION = "0.1.0";
```

- [ ] **Step 9: Write the failing test `packages/vcoin-client/src/index.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { VCOIN_CLIENT_VERSION } from "./index";

describe("package scaffold", () => {
  it("exports a version string matching package.json", () => {
    expect(VCOIN_CLIENT_VERSION).toBe("0.1.0");
  });
});
```

- [ ] **Step 10: Install and run**

```bash
cd /home/sandwitch/Documents/GitHub/Versenco/versenco-shared
pnpm install
pnpm -r test
```
Expected: 1 passed.

- [ ] **Step 11: Verify the build**

```bash
pnpm -r build
ls packages/vcoin-client/dist
```
Expected: `index.js`, `index.cjs`, `index.d.ts` (+ `.map` files) present.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "chore: pnpm workspace + vcoin-client package toolchain"
```

---

## Task 2: Shared types + idempotency helper

**Files:**
- Create: `packages/vcoin-client/src/types.ts`, `packages/vcoin-client/src/idempotency.ts`, `packages/vcoin-client/src/idempotency.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: every type and the `VCoinNetworkError` class used by every subsequent task.

> **Two corrections applied vs. the design spec**, found by cross-checking the
> actual edge-function/RPC responses while writing this plan:
> 1. `vcoin-earn`/`vcoin-spend`/`vcoin-transfer` return **only**
>    `{ success: true, idempotent: true }` (no `balance`/`transactionId`/
>    `amount`) when a duplicate idempotency key is replayed — those fields
>    are not simply optional, they are **absent**. `TransactionResult` and
>    `TransferResult` are modeled as discriminated unions on `idempotent`
>    instead of the spec's flat interface with an optional flag.
> 2. `vcoin-refund`'s `insufficient_balance_for_refund` error carries
>    `balance`/`required` just like `insufficient_balance` does (confirmed in
>    the `vcoin_refund` RPC) — the spec's generic `VCoinBusinessError` bucket
>    didn't have room for those fields, so it gets its own `VCoinResult`
>    branch, same shape as `insufficient_balance`.
> 3. `vcoin-config`'s success response is `{ key, value, ratio }` (value is
>    the raw string, ratio is `parseInt(value, 10)`), not the spec's generic
>    `{ value: unknown }`.

- [ ] **Step 1: Write `packages/vcoin-client/src/types.ts`**

```ts
// ── Network-level error ──────────────────────────────────────────────────

export class VCoinNetworkError extends Error {
  constructor(message: string, readonly status?: number, readonly cause?: unknown) {
    super(message);
    this.name = "VCoinNetworkError";
  }
}

// ── Discriminated result type ────────────────────────────────────────────

export type VCoinBusinessError =
  | "wallet_not_found"
  | "recipient_wallet_not_found"
  | "invalid_recipient"
  | "self_transfer"
  | "transaction_not_found"
  | "already_refunded"
  | "forbidden"
  | "invalid_token"
  | "missing_token"
  | "missing_credentials"
  | "rate_limited"
  | "cannot_spend_for_other_user"
  | "admin_deduct_requires_server_credentials"
  | "config_not_found"
  | "database_error"
  | string;

export type VCoinResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: "insufficient_balance"; balance: number; required: number }
  | { ok: false; error: "insufficient_balance_for_refund"; balance: number; required: number }
  | { ok: false; error: "daily_limit_exceeded"; dailySent: number; dailyLimit: number; remaining: number }
  | { ok: false; error: VCoinBusinessError; detail?: string };

// ── Earn / spend ──────────────────────────────────────────────────────────

export type EarnType = "upload_reward" | "welcome_bonus" | "admin_grant" | "referral";
export type SpendType = "document_purchase" | "decoration" | "payment" | "admin_deduct";

export interface EarnInput {
  userId: string;
  amount: number;
  type: EarnType;
  description?: string;
  referenceId?: string;
  idempotencyKey?: string;
}

export interface SpendInput {
  userId: string;
  amount: number;
  type: SpendType;
  description?: string;
  referenceId?: string;
  idempotencyKey?: string;
}

export type TransactionResult =
  | { idempotent: true }
  | { idempotent: false; balance: number; transactionId: string; amount: number };

// ── Refund ────────────────────────────────────────────────────────────────

export interface RefundInput {
  transactionId: string;
  reason: string;
}

export interface RefundResult {
  refundTransactionId: string;
  originalTransactionId: string;
  balance: number;
  amount: number;
}

// ── Balance ───────────────────────────────────────────────────────────────

export interface BalanceTransaction {
  id: string;
  amount: number;
  balanceAfter: number;
  type: string;
  description: string | null;
  referenceId: string | null;
  appId: string | null;
  createdAt: string;
}

export interface BalanceResult {
  balance: number;
  walletId: string | null;
  updatedAt: string | null;
  transactions: BalanceTransaction[];
}

// ── Config ────────────────────────────────────────────────────────────────

export interface ConfigResult {
  key: string;
  value: string;
  ratio: number;
}

// ── Transfer ──────────────────────────────────────────────────────────────

export interface RecipientInfo {
  walletId: string | null;
  name: string;
  avatarUrl: string | null;
}

export interface TransferInput {
  accessToken: string;
  recipient: string;
  amount: number;
  description?: string;
  idempotencyKey: string;
}

export type TransferResult =
  | { idempotent: true }
  | {
      idempotent: false;
      senderBalance: number;
      recipientWalletId: string;
      txOutId: string;
      txInId: string;
      amount: number;
    };

// ── Client configs ────────────────────────────────────────────────────────

export interface VCoinServerConfig {
  appId: string;
  clientSecret: string;
  baseUrl: string;
}

export interface VCoinUserConfig {
  baseUrl: string;
}

export interface VCoinServerClient {
  earn(input: EarnInput): Promise<VCoinResult<TransactionResult>>;
  spend(input: SpendInput): Promise<VCoinResult<TransactionResult>>;
  refund(input: RefundInput): Promise<VCoinResult<RefundResult>>;
  balance(input: { userId: string }): Promise<VCoinResult<BalanceResult>>;
  getConfig(key?: string): Promise<VCoinResult<ConfigResult>>;
}

export interface VCoinUserClient {
  balance(input: { accessToken: string }): Promise<VCoinResult<BalanceResult>>;
  verifyRecipient(input: { accessToken: string; recipient: string }): Promise<VCoinResult<RecipientInfo>>;
  transfer(input: TransferInput): Promise<VCoinResult<TransferResult>>;
  createCheckout(input: { accessToken: string; packId: string }): Promise<VCoinResult<{ checkoutUrl: string }>>;
}
```

- [ ] **Step 2: Write the failing test `packages/vcoin-client/src/idempotency.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { idempotencyKey } from "./idempotency";

describe("idempotencyKey", () => {
  it("joins parts with underscores", () => {
    expect(idempotencyKey("upload", "doc123", "user456")).toBe("upload_doc123_user456");
  });

  it("is deterministic for the same input", () => {
    expect(idempotencyKey("a", "b")).toBe(idempotencyKey("a", "b"));
  });

  it("produces different keys for different inputs", () => {
    expect(idempotencyKey("a", "b")).not.toBe(idempotencyKey("a", "c"));
  });

  it("throws if called with no parts", () => {
    expect(() => idempotencyKey()).toThrow(/at least one part/);
  });
});
```

- [ ] **Step 3: Run — expect FAIL**

```bash
cd packages/vcoin-client
pnpm exec vitest run src/idempotency.test.ts
```

- [ ] **Step 4: Implement `packages/vcoin-client/src/idempotency.ts`**

```ts
/**
 * Builds a stable idempotency key from one or more parts (e.g. an action
 * name, a resource id, a user id). Replaces the ad-hoc string
 * concatenation (`upload_${documentId}_${userId}`) that every consuming
 * app currently writes by hand.
 */
export function idempotencyKey(...parts: string[]): string {
  if (parts.length === 0) {
    throw new Error("idempotencyKey requires at least one part");
  }
  return parts.map((p) => p.replace(/_/g, "-")).join("_");
}
```

- [ ] **Step 5: Run — expect PASS**

```bash
pnpm exec vitest run src/idempotency.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(vcoin-client): shared types and idempotencyKey helper"
```

---

## Task 3: HTTP fetcher core

**Files:**
- Create: `packages/vcoin-client/src/fetcher.ts`, `packages/vcoin-client/src/fetcher.test.ts`

**Interfaces:**
- Consumes: `VCoinNetworkError`, `VCoinResult` from `./types`.
- Produces:
  - `functionUrl(baseUrl: string, fn: string): string`
  - `interface VCoinRawResponse { status: number; ok: boolean; json: Record<string, unknown> }`
  - `vcoinFetch(url: string, init: { method: "GET" | "POST"; headers: Record<string, string>; body?: unknown }): Promise<VCoinRawResponse>`
  - `genericErrorResult<T>(raw: VCoinRawResponse): VCoinResult<T>` — throws `VCoinNetworkError` if `raw.ok` is true (misuse) or if `raw.json.error` is not a string.

- [ ] **Step 1: Write the failing test `packages/vcoin-client/src/fetcher.test.ts`**

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { functionUrl, vcoinFetch, genericErrorResult } from "./fetcher";
import { VCoinNetworkError } from "./types";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("functionUrl", () => {
  it("joins a base URL without a trailing slash", () => {
    expect(functionUrl("https://auth.versenco.com", "vcoin-earn")).toBe(
      "https://auth.versenco.com/functions/v1/vcoin-earn",
    );
  });

  it("strips a trailing slash from the base URL", () => {
    expect(functionUrl("https://auth.versenco.com/", "vcoin-earn")).toBe(
      "https://auth.versenco.com/functions/v1/vcoin-earn",
    );
  });
});

describe("vcoinFetch", () => {
  it("sends the method, headers, and JSON body, and parses a JSON response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ balance: 100 }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const raw = await vcoinFetch("https://x/y", {
      method: "POST",
      headers: { "x-vcoin-secret": "s3cr3t" },
      body: { user_id: "u1" },
    });

    expect(raw).toEqual({ status: 200, ok: true, json: { balance: 100 } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://x/y");
    expect(init.method).toBe("POST");
    expect(init.headers["x-vcoin-secret"]).toBe("s3cr3t");
    expect(JSON.parse(init.body)).toEqual({ user_id: "u1" });
  });

  it("handles an empty response body as {}", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 204 })));
    const raw = await vcoinFetch("https://x/y", { method: "GET", headers: {} });
    expect(raw).toEqual({ status: 204, ok: true, json: {} });
  });

  it("does not send a body for GET requests without one", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await vcoinFetch("https://x/y", { method: "GET", headers: {} });
    expect(fetchMock.mock.calls[0][1].body).toBeUndefined();
  });

  it("throws VCoinNetworkError when fetch itself rejects", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("DNS fail")));
    await expect(vcoinFetch("https://x/y", { method: "GET", headers: {} })).rejects.toBeInstanceOf(
      VCoinNetworkError,
    );
  });

  it("throws VCoinNetworkError when the response body is not valid JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>", { status: 200 })));
    await expect(vcoinFetch("https://x/y", { method: "GET", headers: {} })).rejects.toBeInstanceOf(
      VCoinNetworkError,
    );
  });
});

describe("genericErrorResult", () => {
  it("maps a known error code, with optional detail", () => {
    const result = genericErrorResult({
      status: 404,
      ok: false,
      json: { error: "wallet_not_found" },
    });
    expect(result).toEqual({ ok: false, error: "wallet_not_found", detail: undefined });
  });

  it("carries a detail string through when present", () => {
    const result = genericErrorResult({
      status: 500,
      ok: false,
      json: { error: "database_error", detail: "constraint violation" },
    });
    expect(result).toEqual({ ok: false, error: "database_error", detail: "constraint violation" });
  });

  it("throws VCoinNetworkError when the failed response has no error code", () => {
    expect(() => genericErrorResult({ status: 500, ok: false, json: {} })).toThrow(VCoinNetworkError);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`Cannot find module './fetcher'`)

- [ ] **Step 3: Implement `packages/vcoin-client/src/fetcher.ts`**

```ts
import { VCoinNetworkError, type VCoinResult } from "./types";

export function functionUrl(baseUrl: string, fn: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/functions/v1/${fn}`;
}

export interface VCoinRawResponse {
  status: number;
  ok: boolean;
  json: Record<string, unknown>;
}

export async function vcoinFetch(
  url: string,
  init: { method: "GET" | "POST"; headers: Record<string, string>; body?: unknown },
): Promise<VCoinRawResponse> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method,
      headers: { "Content-Type": "application/json", ...init.headers },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch (err) {
    throw new VCoinNetworkError("Network error calling the vCoin API", undefined, err);
  }

  const text = await res.text();
  let json: Record<string, unknown>;
  try {
    json = text.length > 0 ? JSON.parse(text) : {};
  } catch (err) {
    throw new VCoinNetworkError("vCoin API returned a non-JSON response", res.status, err);
  }

  return { status: res.status, ok: res.ok, json };
}

export function genericErrorResult<T>(raw: VCoinRawResponse): VCoinResult<T> {
  const code = typeof raw.json.error === "string" ? raw.json.error : undefined;
  if (!code) {
    throw new VCoinNetworkError(`vCoin API returned ${raw.status} with no recognizable error code`, raw.status);
  }
  const detail = typeof raw.json.detail === "string" ? raw.json.detail : undefined;
  return { ok: false, error: code, detail };
}
```

- [ ] **Step 4: Run — expect PASS** (9 tests)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(vcoin-client): HTTP fetcher core (vcoinFetch, genericErrorResult)"
```

---

## Task 4: Response mappers

**Files:**
- Create: `packages/vcoin-client/src/mappers.ts`, `packages/vcoin-client/src/mappers.test.ts`

**Interfaces:**
- Consumes: `VCoinRawResponse` from `./fetcher`, `genericErrorResult` from `./fetcher`, all result types from `./types`.
- Produces: `toTransactionResult`, `toRefundResult`, `toBalanceResult`, `toConfigResult`, `toRecipientInfo`, `toTransferResult`, `toCheckoutResult` — each `(raw: VCoinRawResponse) => VCoinResult<T>` for its `T`. Used by `server.ts` (Task 5) and `user.ts` (Task 6... actually Task 6 is user client, see below).

- [ ] **Step 1: Write the failing test `packages/vcoin-client/src/mappers.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import {
  toTransactionResult,
  toRefundResult,
  toBalanceResult,
  toConfigResult,
  toRecipientInfo,
  toTransferResult,
  toCheckoutResult,
} from "./mappers";
import { VCoinNetworkError } from "./types";

describe("toTransactionResult", () => {
  it("maps a normal earn/spend success", () => {
    const r = toTransactionResult({
      status: 200, ok: true,
      json: { success: true, balance: 150, transaction_id: "tx1", amount: 50 },
    });
    expect(r).toEqual({ ok: true, data: { idempotent: false, balance: 150, transactionId: "tx1", amount: 50 } });
  });

  it("maps a replayed idempotency key to the idempotent-only shape", () => {
    const r = toTransactionResult({ status: 200, ok: true, json: { success: true, idempotent: true } });
    expect(r).toEqual({ ok: true, data: { idempotent: true } });
  });

  it("maps insufficient_balance (spend) with balance/required", () => {
    const r = toTransactionResult({
      status: 402, ok: false,
      json: { error: "insufficient_balance", balance: 5, required: 10 },
    });
    expect(r).toEqual({ ok: false, error: "insufficient_balance", balance: 5, required: 10 });
  });

  it("falls back to a generic error for wallet_not_found", () => {
    const r = toTransactionResult({ status: 404, ok: false, json: { error: "wallet_not_found" } });
    expect(r).toEqual({ ok: false, error: "wallet_not_found", detail: undefined });
  });
});

describe("toRefundResult", () => {
  it("maps a successful refund", () => {
    const r = toRefundResult({
      status: 200, ok: true,
      json: {
        success: true, refund_transaction_id: "rtx1", original_transaction_id: "tx1",
        balance: 60, amount: -10,
      },
    });
    expect(r).toEqual({
      ok: true,
      data: { refundTransactionId: "rtx1", originalTransactionId: "tx1", balance: 60, amount: -10 },
    });
  });

  it("maps insufficient_balance_for_refund with balance/required", () => {
    const r = toRefundResult({
      status: 400, ok: false,
      json: { error: "insufficient_balance_for_refund", balance: 3, required: 50 },
    });
    expect(r).toEqual({ ok: false, error: "insufficient_balance_for_refund", balance: 3, required: 50 });
  });

  it("falls back to generic for already_refunded", () => {
    const r = toRefundResult({ status: 400, ok: false, json: { error: "already_refunded" } });
    expect(r).toEqual({ ok: false, error: "already_refunded", detail: undefined });
  });
});

describe("toBalanceResult", () => {
  it("maps balance + transactions from snake_case to camelCase", () => {
    const r = toBalanceResult({
      status: 200, ok: true,
      json: {
        balance: 42, wallet_id: "VRN-AAAA-BBBB", updated_at: "2026-09-22T00:00:00Z",
        transactions: [
          {
            id: "tx1", amount: -10, balance_after: 42, type: "document_purchase",
            description: "Downloaded X", reference_id: "doc1", app_id: "versen-education",
            created_at: "2026-09-21T00:00:00Z",
          },
        ],
      },
    });
    expect(r).toEqual({
      ok: true,
      data: {
        balance: 42, walletId: "VRN-AAAA-BBBB", updatedAt: "2026-09-22T00:00:00Z",
        transactions: [{
          id: "tx1", amount: -10, balanceAfter: 42, type: "document_purchase",
          description: "Downloaded X", referenceId: "doc1", appId: "versen-education",
          createdAt: "2026-09-21T00:00:00Z",
        }],
      },
    });
  });

  it("defaults transactions to an empty array when absent", () => {
    const r = toBalanceResult({ status: 200, ok: true, json: { balance: 0, wallet_id: null, updated_at: null } });
    expect(r.ok && r.data.transactions).toEqual([]);
  });
});

describe("toConfigResult", () => {
  it("maps key/value/ratio on success", () => {
    const r = toConfigResult({ status: 200, ok: true, json: { key: "vcoin_to_xof_ratio", value: "10", ratio: 10 } });
    expect(r).toEqual({ ok: true, data: { key: "vcoin_to_xof_ratio", value: "10", ratio: 10 } });
  });

  it("maps config_not_found", () => {
    const r = toConfigResult({ status: 404, ok: false, json: { error: "config_not_found", value: null } });
    expect(r).toEqual({ ok: false, error: "config_not_found", detail: undefined });
  });
});

describe("toRecipientInfo", () => {
  it("maps a verify response", () => {
    const r = toRecipientInfo({
      status: 200, ok: true,
      json: { valid: true, wallet_id: "VRN-CCCC-DDDD", name: "Ada", avatar_url: null },
    });
    expect(r).toEqual({ ok: true, data: { walletId: "VRN-CCCC-DDDD", name: "Ada", avatarUrl: null } });
  });
});

describe("toTransferResult", () => {
  it("maps a successful transfer", () => {
    const r = toTransferResult({
      status: 200, ok: true,
      json: { sender_balance: 90, recipient_wallet_id: "VRN-EEEE-FFFF", tx_out_id: "o1", tx_in_id: "i1", amount: 10 },
    });
    expect(r).toEqual({
      ok: true,
      data: { idempotent: false, senderBalance: 90, recipientWalletId: "VRN-EEEE-FFFF", txOutId: "o1", txInId: "i1", amount: 10 },
    });
  });

  it("maps a replayed transfer idempotency key", () => {
    const r = toTransferResult({ status: 200, ok: true, json: { success: true, idempotent: true } });
    expect(r).toEqual({ ok: true, data: { idempotent: true } });
  });

  it("maps daily_limit_exceeded", () => {
    const r = toTransferResult({
      status: 200, ok: true,
      json: { error: "daily_limit_exceeded", daily_sent: 1900, daily_limit: 2000, remaining: 100 },
    });
    expect(r).toEqual({ ok: false, error: "daily_limit_exceeded", dailySent: 1900, dailyLimit: 2000, remaining: 100 });
  });

  it("maps insufficient_balance on transfer", () => {
    const r = toTransferResult({ status: 200, ok: true, json: { error: "insufficient_balance", balance: 1, required: 10 } });
    expect(r).toEqual({ ok: false, error: "insufficient_balance", balance: 1, required: 10 });
  });
});

describe("toCheckoutResult", () => {
  it("maps checkout_url", () => {
    const r = toCheckoutResult({ status: 200, ok: true, json: { checkout_url: "https://pay.versenco.com/checkout?x=1" } });
    expect(r).toEqual({ ok: true, data: { checkoutUrl: "https://pay.versenco.com/checkout?x=1" } });
  });
});
```

> Note the `daily_limit_exceeded` and `insufficient_balance` fixtures for
> `toTransferResult` use `ok: true` at the HTTP layer — `vcoin-transfer`'s
> RPC-business errors are returned by the edge function as **HTTP 200** with
> an `error` field in the body (unlike spend/refund, which use 402/400).
> `toTransferResult` therefore checks `raw.json.error` regardless of
> `raw.ok`, while `toTransactionResult`/`toRefundResult` check `raw.ok` first.

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement `packages/vcoin-client/src/mappers.ts`**

```ts
import { genericErrorResult, type VCoinRawResponse } from "./fetcher";
import type {
  BalanceResult,
  BalanceTransaction,
  ConfigResult,
  RecipientInfo,
  RefundResult,
  TransactionResult,
  TransferResult,
  VCoinResult,
} from "./types";

function num(v: unknown): number {
  return v as number;
}
function str(v: unknown): string {
  return v as string;
}
function strOrNull(v: unknown): string | null {
  return (v as string | null) ?? null;
}

export function toTransactionResult(raw: VCoinRawResponse): VCoinResult<TransactionResult> {
  if (raw.ok) {
    if (raw.json.idempotent === true) {
      return { ok: true, data: { idempotent: true } };
    }
    return {
      ok: true,
      data: {
        idempotent: false,
        balance: num(raw.json.balance),
        transactionId: str(raw.json.transaction_id),
        amount: num(raw.json.amount),
      },
    };
  }
  if (raw.json.error === "insufficient_balance") {
    return { ok: false, error: "insufficient_balance", balance: num(raw.json.balance), required: num(raw.json.required) };
  }
  return genericErrorResult<TransactionResult>(raw);
}

export function toRefundResult(raw: VCoinRawResponse): VCoinResult<RefundResult> {
  if (raw.ok) {
    return {
      ok: true,
      data: {
        refundTransactionId: str(raw.json.refund_transaction_id),
        originalTransactionId: str(raw.json.original_transaction_id),
        balance: num(raw.json.balance),
        amount: num(raw.json.amount),
      },
    };
  }
  if (raw.json.error === "insufficient_balance_for_refund") {
    return {
      ok: false,
      error: "insufficient_balance_for_refund",
      balance: num(raw.json.balance),
      required: num(raw.json.required),
    };
  }
  return genericErrorResult<RefundResult>(raw);
}

export function toBalanceResult(raw: VCoinRawResponse): VCoinResult<BalanceResult> {
  if (!raw.ok) return genericErrorResult<BalanceResult>(raw);
  const rawTx = (raw.json.transactions as Record<string, unknown>[] | undefined) ?? [];
  const transactions: BalanceTransaction[] = rawTx.map((t) => ({
    id: str(t.id),
    amount: num(t.amount),
    balanceAfter: num(t.balance_after),
    type: str(t.type),
    description: strOrNull(t.description),
    referenceId: strOrNull(t.reference_id),
    appId: strOrNull(t.app_id),
    createdAt: str(t.created_at),
  }));
  return {
    ok: true,
    data: {
      balance: num(raw.json.balance),
      walletId: strOrNull(raw.json.wallet_id),
      updatedAt: strOrNull(raw.json.updated_at),
      transactions,
    },
  };
}

export function toConfigResult(raw: VCoinRawResponse): VCoinResult<ConfigResult> {
  if (!raw.ok) return genericErrorResult<ConfigResult>(raw);
  return {
    ok: true,
    data: { key: str(raw.json.key), value: str(raw.json.value), ratio: num(raw.json.ratio) },
  };
}

export function toRecipientInfo(raw: VCoinRawResponse): VCoinResult<RecipientInfo> {
  if (!raw.ok) return genericErrorResult<RecipientInfo>(raw);
  return {
    ok: true,
    data: {
      walletId: strOrNull(raw.json.wallet_id),
      name: str(raw.json.name),
      avatarUrl: strOrNull(raw.json.avatar_url),
    },
  };
}

export function toTransferResult(raw: VCoinRawResponse): VCoinResult<TransferResult> {
  // vcoin-transfer returns business errors as HTTP 200 with an `error` field,
  // unlike spend/refund — check the body's `error` before trusting `raw.ok`.
  if (raw.json.error === "insufficient_balance") {
    return { ok: false, error: "insufficient_balance", balance: num(raw.json.balance), required: num(raw.json.required) };
  }
  if (raw.json.error === "daily_limit_exceeded") {
    return {
      ok: false,
      error: "daily_limit_exceeded",
      dailySent: num(raw.json.daily_sent),
      dailyLimit: num(raw.json.daily_limit),
      remaining: num(raw.json.remaining),
    };
  }
  if (!raw.ok || typeof raw.json.error === "string") {
    return genericErrorResult<TransferResult>(raw);
  }
  if (raw.json.idempotent === true) {
    return { ok: true, data: { idempotent: true } };
  }
  return {
    ok: true,
    data: {
      idempotent: false,
      senderBalance: num(raw.json.sender_balance),
      recipientWalletId: str(raw.json.recipient_wallet_id),
      txOutId: str(raw.json.tx_out_id),
      txInId: str(raw.json.tx_in_id),
      amount: num(raw.json.amount),
    },
  };
}

export function toCheckoutResult(raw: VCoinRawResponse): VCoinResult<{ checkoutUrl: string }> {
  if (!raw.ok) return genericErrorResult<{ checkoutUrl: string }>(raw);
  return { ok: true, data: { checkoutUrl: str(raw.json.checkout_url) } };
}
```

- [ ] **Step 4: Run — expect PASS** (16 tests)

```bash
pnpm exec vitest run src/mappers.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(vcoin-client): response mappers for every vcoin-* endpoint"
```

---

## Task 5: `createVCoinServerClient`

**Files:**
- Create: `packages/vcoin-client/src/server.ts`, `packages/vcoin-client/src/server.test.ts`

**Interfaces:**
- Consumes: `vcoinFetch`, `functionUrl` from `./fetcher`; every `to*Result` mapper from `./mappers`; `VCoinServerConfig`, `VCoinServerClient`, `EarnInput`, `SpendInput`, `RefundInput` from `./types`.
- Produces: `createVCoinServerClient(config: VCoinServerConfig): VCoinServerClient`.

- [ ] **Step 1: Write the failing test `packages/vcoin-client/src/server.test.ts`**

```ts
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { createVCoinServerClient } from "./server";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

const client = () =>
  createVCoinServerClient({
    appId: "versen-education",
    clientSecret: "srv-secret",
    baseUrl: "https://auth.versenco.com",
  });

describe("createVCoinServerClient", () => {
  it("earn() posts to vcoin-earn with the secret header and app_id in the body", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, balance: 50, transaction_id: "tx1", amount: 50 }));

    const result = await client().earn({
      userId: "u1", amount: 50, type: "upload_reward", description: "d", referenceId: "doc1", idempotencyKey: "k1",
    });

    expect(result).toEqual({ ok: true, data: { idempotent: false, balance: 50, transactionId: "tx1", amount: 50 } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://auth.versenco.com/functions/v1/vcoin-earn");
    expect(init.headers["x-vcoin-secret"]).toBe("srv-secret");
    expect(init.headers["app_id"]).toBeUndefined(); // must be in body, not a header
    const body = JSON.parse(init.body);
    expect(body).toEqual({
      user_id: "u1", amount: 50, type: "upload_reward", description: "d",
      reference_id: "doc1", app_id: "versen-education", idempotency_key: "k1",
    });
  });

  it("spend() posts to vcoin-spend and surfaces insufficient_balance", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "insufficient_balance", balance: 5, required: 10 }, 402));
    const result = await client().spend({ userId: "u1", amount: 10, type: "document_purchase" });
    expect(result).toEqual({ ok: false, error: "insufficient_balance", balance: 5, required: 10 });
    expect(fetchMock.mock.calls[0][0]).toBe("https://auth.versenco.com/functions/v1/vcoin-spend");
  });

  it("refund() posts transaction_id/reason/app_id", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ success: true, refund_transaction_id: "r1", original_transaction_id: "tx1", balance: 60, amount: -10 }),
    );
    const result = await client().refund({ transactionId: "tx1", reason: "duplicate charge" });
    expect(result).toEqual({
      ok: true,
      data: { refundTransactionId: "r1", originalTransactionId: "tx1", balance: 60, amount: -10 },
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({ transaction_id: "tx1", reason: "duplicate charge", app_id: "versen-education" });
  });

  it("balance() sends the secret + app-id headers and user_id as a query param, no body", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ balance: 10, wallet_id: null, updated_at: null, transactions: [] }));
    await client().balance({ userId: "u1" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://auth.versenco.com/functions/v1/vcoin-balance?user_id=u1");
    expect(init.method).toBe("GET");
    expect(init.headers["x-vcoin-secret"]).toBe("srv-secret");
    expect(init.headers["x-app-id"]).toBe("versen-education");
    expect(init.body).toBeUndefined();
  });

  it("getConfig() defaults to no query string and requires no secret", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ key: "vcoin_to_xof_ratio", value: "10", ratio: 10 }));
    const result = await client().getConfig();
    expect(result).toEqual({ ok: true, data: { key: "vcoin_to_xof_ratio", value: "10", ratio: 10 } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://auth.versenco.com/functions/v1/vcoin-config");
    expect(init.headers["x-vcoin-secret"]).toBeUndefined();
  });

  it("getConfig(key) appends the key as a query param", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ key: "other_key", value: "5", ratio: 5 }));
    await client().getConfig("other_key");
    expect(fetchMock.mock.calls[0][0]).toBe("https://auth.versenco.com/functions/v1/vcoin-config?key=other_key");
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement `packages/vcoin-client/src/server.ts`**

```ts
import { functionUrl, vcoinFetch } from "./fetcher";
import {
  toBalanceResult,
  toConfigResult,
  toRefundResult,
  toTransactionResult,
} from "./mappers";
import type {
  BalanceResult,
  ConfigResult,
  EarnInput,
  RefundInput,
  RefundResult,
  SpendInput,
  TransactionResult,
  VCoinResult,
  VCoinServerClient,
  VCoinServerConfig,
} from "./types";

export function createVCoinServerClient(config: VCoinServerConfig): VCoinServerClient {
  async function earn(input: EarnInput): Promise<VCoinResult<TransactionResult>> {
    const raw = await vcoinFetch(functionUrl(config.baseUrl, "vcoin-earn"), {
      method: "POST",
      headers: { "x-vcoin-secret": config.clientSecret },
      body: {
        user_id: input.userId,
        amount: input.amount,
        type: input.type,
        description: input.description,
        reference_id: input.referenceId,
        app_id: config.appId,
        idempotency_key: input.idempotencyKey,
      },
    });
    return toTransactionResult(raw);
  }

  async function spend(input: SpendInput): Promise<VCoinResult<TransactionResult>> {
    const raw = await vcoinFetch(functionUrl(config.baseUrl, "vcoin-spend"), {
      method: "POST",
      headers: { "x-vcoin-secret": config.clientSecret },
      body: {
        user_id: input.userId,
        amount: input.amount,
        type: input.type,
        description: input.description,
        reference_id: input.referenceId,
        app_id: config.appId,
        idempotency_key: input.idempotencyKey,
      },
    });
    return toTransactionResult(raw);
  }

  async function refund(input: RefundInput): Promise<VCoinResult<RefundResult>> {
    const raw = await vcoinFetch(functionUrl(config.baseUrl, "vcoin-refund"), {
      method: "POST",
      headers: { "x-vcoin-secret": config.clientSecret },
      body: { transaction_id: input.transactionId, reason: input.reason, app_id: config.appId },
    });
    return toRefundResult(raw);
  }

  async function balance(input: { userId: string }): Promise<VCoinResult<BalanceResult>> {
    const url = `${functionUrl(config.baseUrl, "vcoin-balance")}?user_id=${encodeURIComponent(input.userId)}`;
    const raw = await vcoinFetch(url, {
      method: "GET",
      headers: { "x-vcoin-secret": config.clientSecret, "x-app-id": config.appId },
    });
    return toBalanceResult(raw);
  }

  async function getConfig(key?: string): Promise<VCoinResult<ConfigResult>> {
    const qs = key ? `?key=${encodeURIComponent(key)}` : "";
    const raw = await vcoinFetch(`${functionUrl(config.baseUrl, "vcoin-config")}${qs}`, {
      method: "GET",
      headers: {},
    });
    return toConfigResult(raw);
  }

  return { earn, spend, refund, balance, getConfig };
}
```

- [ ] **Step 4: Run — expect PASS** (6 tests)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(vcoin-client): createVCoinServerClient"
```

---

## Task 6: `createVCoinUserClient`

**Files:**
- Create: `packages/vcoin-client/src/user.ts`, `packages/vcoin-client/src/user.test.ts`

**Interfaces:**
- Consumes: `vcoinFetch`, `functionUrl` from `./fetcher`; `toBalanceResult`, `toRecipientInfo`, `toTransferResult`, `toCheckoutResult` from `./mappers`; `VCoinUserConfig`, `VCoinUserClient`, `TransferInput` from `./types`.
- Produces: `createVCoinUserClient(config: VCoinUserConfig): VCoinUserClient`.

- [ ] **Step 1: Write the failing test `packages/vcoin-client/src/user.test.ts`**

```ts
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { createVCoinUserClient } from "./user";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

const client = () => createVCoinUserClient({ baseUrl: "https://auth.versenco.com" });

describe("createVCoinUserClient", () => {
  it("balance() sends only a Bearer token, no secret", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ balance: 5, wallet_id: null, updated_at: null, transactions: [] }));
    await client().balance({ accessToken: "jwt-abc" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://auth.versenco.com/functions/v1/vcoin-balance");
    expect(init.headers.Authorization).toBe("Bearer jwt-abc");
    expect(init.headers["x-vcoin-secret"]).toBeUndefined();
  });

  it("verifyRecipient() posts action:verify", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ valid: true, wallet_id: "VRN-1", name: "Ada", avatar_url: null }));
    const result = await client().verifyRecipient({ accessToken: "jwt-abc", recipient: "VRN-1" });
    expect(result).toEqual({ ok: true, data: { walletId: "VRN-1", name: "Ada", avatarUrl: null } });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({ action: "verify", recipient: "VRN-1" });
  });

  it("transfer() posts action:transfer with all fields", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ sender_balance: 90, recipient_wallet_id: "VRN-2", tx_out_id: "o1", tx_in_id: "i1", amount: 10 }),
    );
    const result = await client().transfer({
      accessToken: "jwt-abc", recipient: "VRN-2", amount: 10, description: "gift", idempotencyKey: "tx-key-1",
    });
    expect(result).toEqual({
      ok: true,
      data: { idempotent: false, senderBalance: 90, recipientWalletId: "VRN-2", txOutId: "o1", txInId: "i1", amount: 10 },
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({ action: "transfer", recipient: "VRN-2", amount: 10, description: "gift", idempotency_key: "tx-key-1" });
  });

  it("createCheckout() posts pack_id and maps checkout_url", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ checkout_url: "https://pay.versenco.com/checkout?s=1" }));
    const result = await client().createCheckout({ accessToken: "jwt-abc", packId: "pack_100" });
    expect(result).toEqual({ ok: true, data: { checkoutUrl: "https://pay.versenco.com/checkout?s=1" } });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({ pack_id: "pack_100" });
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement `packages/vcoin-client/src/user.ts`**

```ts
import { functionUrl, vcoinFetch } from "./fetcher";
import { toBalanceResult, toCheckoutResult, toRecipientInfo, toTransferResult } from "./mappers";
import type {
  BalanceResult,
  RecipientInfo,
  TransferInput,
  TransferResult,
  VCoinResult,
  VCoinUserClient,
  VCoinUserConfig,
} from "./types";

export function createVCoinUserClient(config: VCoinUserConfig): VCoinUserClient {
  async function balance(input: { accessToken: string }): Promise<VCoinResult<BalanceResult>> {
    const raw = await vcoinFetch(functionUrl(config.baseUrl, "vcoin-balance"), {
      method: "GET",
      headers: { Authorization: `Bearer ${input.accessToken}` },
    });
    return toBalanceResult(raw);
  }

  async function verifyRecipient(input: {
    accessToken: string;
    recipient: string;
  }): Promise<VCoinResult<RecipientInfo>> {
    const raw = await vcoinFetch(functionUrl(config.baseUrl, "vcoin-transfer"), {
      method: "POST",
      headers: { Authorization: `Bearer ${input.accessToken}` },
      body: { action: "verify", recipient: input.recipient },
    });
    return toRecipientInfo(raw);
  }

  async function transfer(input: TransferInput): Promise<VCoinResult<TransferResult>> {
    const raw = await vcoinFetch(functionUrl(config.baseUrl, "vcoin-transfer"), {
      method: "POST",
      headers: { Authorization: `Bearer ${input.accessToken}` },
      body: {
        action: "transfer",
        recipient: input.recipient,
        amount: input.amount,
        description: input.description,
        idempotency_key: input.idempotencyKey,
      },
    });
    return toTransferResult(raw);
  }

  async function createCheckout(input: {
    accessToken: string;
    packId: string;
  }): Promise<VCoinResult<{ checkoutUrl: string }>> {
    const raw = await vcoinFetch(functionUrl(config.baseUrl, "vcoin-create-checkout"), {
      method: "POST",
      headers: { Authorization: `Bearer ${input.accessToken}` },
      body: { pack_id: input.packId },
    });
    return toCheckoutResult(raw);
  }

  return { balance, verifyRecipient, transfer, createCheckout };
}
```

- [ ] **Step 4: Run — expect PASS** (4 tests)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(vcoin-client): createVCoinUserClient"
```

---

## Task 7: Public exports, secret-redaction test, README/LICENSE/CHANGELOG, publish CI

**Files:**
- Modify: `packages/vcoin-client/src/index.ts`, `packages/vcoin-client/src/index.test.ts`
- Create: `packages/vcoin-client/README.md`, `packages/vcoin-client/LICENSE`, `packages/vcoin-client/CHANGELOG.md`, `.github/workflows/vcoin-client-publish.yml`

**Interfaces:**
- Consumes: everything from `./types`, `./idempotency`, `./server`, `./user`.
- Produces: the package's complete public API surface (final, importable as `@versenco/vcoin-client`).

- [ ] **Step 1: Replace `packages/vcoin-client/src/index.ts`**

```ts
export const VCOIN_CLIENT_VERSION = "0.1.0";

export { createVCoinServerClient } from "./server";
export { createVCoinUserClient } from "./user";
export { idempotencyKey } from "./idempotency";

export {
  VCoinNetworkError,
  type VCoinResult,
  type VCoinBusinessError,
  type EarnType,
  type SpendType,
  type EarnInput,
  type SpendInput,
  type TransactionResult,
  type RefundInput,
  type RefundResult,
  type BalanceResult,
  type BalanceTransaction,
  type ConfigResult,
  type RecipientInfo,
  type TransferInput,
  type TransferResult,
  type VCoinServerConfig,
  type VCoinUserConfig,
  type VCoinServerClient,
  type VCoinUserClient,
} from "./types";
```

- [ ] **Step 2: Replace `packages/vcoin-client/src/index.test.ts`** with secret-redaction and wire-contract tests

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createVCoinServerClient, createVCoinUserClient, VCOIN_CLIENT_VERSION } from "./index";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ balance: 1, transactions: [] }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("package exports", () => {
  it("exposes the version constant", () => {
    expect(VCOIN_CLIENT_VERSION).toBe("0.1.0");
  });
});

describe("secret redaction", () => {
  const SECRET = "SECRET_MARKER_XYZ";
  const TOKEN = "TOKEN_MARKER_XYZ";

  it("never puts the server client secret in a URL", async () => {
    const server = createVCoinServerClient({ appId: "app1", clientSecret: SECRET, baseUrl: "https://x" });
    await server.balance({ userId: "u1" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).not.toContain(SECRET);
    expect(init.headers["x-vcoin-secret"]).toBe(SECRET);
  });

  it("never puts the user access token in a URL", async () => {
    const user = createVCoinUserClient({ baseUrl: "https://x" });
    await user.balance({ accessToken: TOKEN });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).not.toContain(TOKEN);
    expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
  });
});

describe("wire contract — headers and body field names", () => {
  it("earn/spend/refund put app_id in the BODY, not a header", async () => {
    const server = createVCoinServerClient({ appId: "versen-pay", clientSecret: "s", baseUrl: "https://x" });
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ success: true, balance: 1, transaction_id: "t", amount: 1 }), { status: 200 }));
    await server.earn({ userId: "u", amount: 1, type: "welcome_bonus" });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers["app_id"]).toBeUndefined();
    expect(init.headers["x-app-id"]).toBeUndefined();
    expect(JSON.parse(init.body).app_id).toBe("versen-pay");
  });

  it("balance (server) puts app id in an x-app-id HEADER, not the body", async () => {
    const server = createVCoinServerClient({ appId: "versen-pay", clientSecret: "s", baseUrl: "https://x" });
    await server.balance({ userId: "u" });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers["x-app-id"]).toBe("versen-pay");
    expect(init.body).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run the full suite — expect PASS**

```bash
cd /home/sandwitch/Documents/GitHub/Versenco/versenco-shared
pnpm -r test
```
Expected: all tests across every file pass (idempotency, fetcher, mappers, server, user, index).

- [ ] **Step 4: Typecheck and build**

```bash
pnpm --filter @versenco/vcoin-client exec tsc --noEmit
pnpm -r build
```
Expected: no type errors; `packages/vcoin-client/dist/index.js`, `.cjs`, `.d.ts` regenerated.

- [ ] **Step 5: Write `packages/vcoin-client/LICENSE`**

```
MIT License

Copyright (c) 2026 Versenco

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 6: Write `packages/vcoin-client/README.md`**

```markdown
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
```

- [ ] **Step 7: Write `packages/vcoin-client/CHANGELOG.md`**

```markdown
# Changelog

## 0.1.0 — 2026-09-22

Initial release.

- `createVCoinServerClient`: `earn`, `spend`, `refund`, `balance`, `getConfig`.
- `createVCoinUserClient`: `balance`, `verifyRecipient`, `transfer`, `createCheckout`.
- `idempotencyKey` helper.
- Full TypeScript types, no runtime dependencies.
```

- [ ] **Step 8: Write `.github/workflows/vcoin-client-publish.yml`**

```yaml
name: Publish vcoin-client

on:
  push:
    tags:
      - "vcoin-client@*"

jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 9

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          registry-url: "https://registry.npmjs.org"

      - run: pnpm install --frozen-lockfile

      - run: pnpm --filter @versenco/vcoin-client test

      - run: pnpm --filter @versenco/vcoin-client exec tsc --noEmit

      - run: pnpm --filter @versenco/vcoin-client build

      - name: Publish
        working-directory: packages/vcoin-client
        run: pnpm publish --access public --provenance --no-git-checks
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(vcoin-client): public exports, secret-redaction tests, README/LICENSE/CHANGELOG, publish CI"
```

- [ ] **Step 10: Tag the release (only once Task 0's operator steps are done)**

```bash
git tag vcoin-client@0.1.0
git push origin main --tags
```
This triggers `.github/workflows/vcoin-client-publish.yml`, which publishes
`@versenco/vcoin-client@0.1.0` to the public npm registry.

---

## Self-Review

**1. Spec coverage** (against `docs/superpowers/specs/2026-09-22-vcoin-client-design.md`):

| Spec section | Task |
|---|---|
| §1 Public npm, secrets never embedded | Task 7 (redaction tests), all client configs (Tasks 2, 5, 6) |
| §2 pnpm workspace, npm publish, semver, `@versenco` scope | Task 1 (workspace), Task 7 (CI publish), Task 0 (scope reservation) |
| §3 Two structurally separate clients | Task 5 (`server.ts`), Task 6 (`user.ts`) — two files, two factory functions, no shared "god client" |
| §4 `createVCoinServerClient` API (earn/spend/refund/balance/getConfig) | Task 5, types in Task 2 |
| §5 `createVCoinUserClient` API (balance/verifyRecipient/transfer/createCheckout) | Task 6, types in Task 2 |
| §6 `VCoinResult<T>` discriminated union, `VCoinNetworkError` | Task 2 (types), Task 3 (fetcher raises it), Task 4 (mappers use it) |
| §7 `idempotencyKey` helper | Task 2 |
| §8 Tests (per-method, secret-in-URL, wire-contract) | Tasks 3–6 (per-method), Task 7 (redaction + contract tests) |
| §9 CI publish on tag | Task 7 Step 8 |
| §10 Consumption example | README in Task 7 mirrors it |
| §11 Out of scope (SSO/vCaptcha, migrations, self-serve portal, retries, zod) | Not built — confirmed absent from every task |

**2. Placeholder scan:** no "TBD"/"add error handling"-style steps; every
code block is complete and runnable as written; the three spec corrections
(idempotent-replay shape, `insufficient_balance_for_refund` fields,
`vcoin-config` response shape) are explicit and justified against the real
edge-function/RPC source, not left ambiguous.

**3. Type consistency:**
- `VCoinResult<T>`, `VCoinNetworkError`, `VCoinBusinessError` (Task 2) are the
  exact names imported in `fetcher.ts` (Task 3), `mappers.ts` (Task 4),
  `server.ts`/`user.ts` (Tasks 5–6), and re-exported unchanged from
  `index.ts` (Task 7).
- `TransactionResult` and `TransferResult` use the corrected discriminated
  `idempotent` shape everywhere they appear (types, mappers, server/user
  clients, and their tests) — no task reverts to the flat optional-flag shape
  from the original spec text.
- `VCoinRawResponse` (Task 3) has the same three fields (`status`, `ok`,
  `json`) used identically by every mapper in Task 4 and both clients.
- Every mapper function name used in Task 5/6 (`toTransactionResult`,
  `toRefundResult`, `toBalanceResult`, `toConfigResult`, `toRecipientInfo`,
  `toTransferResult`, `toCheckoutResult`) matches its definition in Task 4
  exactly.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-09-22-vcoin-client-implementation.md`.**

Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using `executing-plans`, batch execution with checkpoints.

Which approach?
