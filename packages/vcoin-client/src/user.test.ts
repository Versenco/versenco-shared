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
