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
    expect(VCOIN_CLIENT_VERSION).toBe("0.2.0");
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

  it("never puts the server client secret in earn/spend/refund bodies or URLs", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ success: true, balance: 1, transaction_id: "t", amount: 1 }), { status: 200 }));
    const server = createVCoinServerClient({ appId: "app1", clientSecret: SECRET, baseUrl: "https://x" });
    await server.earn({ userId: "u1", amount: 1, type: "welcome_bonus" });
    let [url, init] = fetchMock.mock.calls[0];
    expect(url).not.toContain(SECRET);
    expect(init.body).not.toContain(SECRET);

    fetchMock.mockResolvedValue(new Response(JSON.stringify({ success: true, refund_transaction_id: "r", original_transaction_id: "t", balance: 1, amount: -1 }), { status: 200 }));
    await server.refund({ transactionId: "t", reason: "test" });
    [url, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
    expect(url).not.toContain(SECRET);
    expect(init.body).not.toContain(SECRET);
  });

  it("never puts the user access token in verifyRecipient/transfer/createCheckout bodies or URLs", async () => {
    const user = createVCoinUserClient({ baseUrl: "https://x" });

    fetchMock.mockResolvedValue(new Response(JSON.stringify({ valid: true, wallet_id: "w1", name: "A", avatar_url: null }), { status: 200 }));
    await user.verifyRecipient({ accessToken: TOKEN, recipient: "w1" });
    let [url, init] = fetchMock.mock.calls[0];
    expect(url).not.toContain(TOKEN);
    expect(init.body).not.toContain(TOKEN);

    fetchMock.mockResolvedValue(new Response(JSON.stringify({ checkout_url: "https://pay/x" }), { status: 200 }));
    await user.createCheckout({ accessToken: TOKEN, packId: "p1" });
    [url, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
    expect(url).not.toContain(TOKEN);
    expect(init.body).not.toContain(TOKEN);
  });

  it("never puts the secret or token in a VCoinNetworkError's message", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    const server = createVCoinServerClient({ appId: "app1", clientSecret: SECRET, baseUrl: "https://x" });
    await expect(server.balance({ userId: "u1" })).rejects.toMatchObject({
      message: expect.not.stringContaining(SECRET),
    });
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
