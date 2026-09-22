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
