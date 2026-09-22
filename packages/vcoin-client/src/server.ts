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
