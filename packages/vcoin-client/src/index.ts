export const VCOIN_CLIENT_VERSION = "0.2.0";

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
