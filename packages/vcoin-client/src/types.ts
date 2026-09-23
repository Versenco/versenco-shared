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
  | "database_error";

export type VCoinResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: "insufficient_balance"; balance: number; required: number }
  | { ok: false; error: "insufficient_balance_for_refund"; balance: number; required: number }
  | { ok: false; error: "daily_limit_exceeded"; dailySent: number; dailyLimit: number; remaining: number }
  | { ok: false; error: VCoinBusinessError; detail?: string };

// ── Earn / spend ──────────────────────────────────────────────────────────

export type EarnType = "upload_reward" | "welcome_bonus" | "admin_grant" | "referral" | "report_resolved";
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
  /** Per-request timeout in milliseconds (default 30000). On expiry a VCoinNetworkError is thrown. */
  timeoutMs?: number;
}

export interface VCoinUserConfig {
  baseUrl: string;
  /** Per-request timeout in milliseconds (default 30000). On expiry a VCoinNetworkError is thrown. */
  timeoutMs?: number;
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
