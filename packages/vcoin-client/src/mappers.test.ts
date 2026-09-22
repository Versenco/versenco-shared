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
