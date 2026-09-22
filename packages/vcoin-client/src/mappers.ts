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
  // vcoin-transfer's business errors use real HTTP status codes (402 for
  // insufficient_balance, 429 for daily_limit_exceeded) — but we check
  // raw.json.error before trusting raw.ok as defense in depth, since this
  // endpoint's exact status-code contract isn't guaranteed stable.
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
