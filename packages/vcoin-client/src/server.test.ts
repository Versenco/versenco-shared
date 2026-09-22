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
