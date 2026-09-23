import { describe, it, expect, vi, afterEach } from "vitest";
import { createVCoinServerClient, type EarnType } from "./index";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("EarnType", () => {
  it("includes report_resolved and sends it as the transaction type", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ success: true, balance: 1, transaction_id: "t", amount: 1 }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const type: EarnType = "report_resolved";
    const client = createVCoinServerClient({ appId: "codeben-app", clientSecret: "s", baseUrl: "https://x" });
    await client.earn({ userId: "u", amount: 1, type });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).type).toBe("report_resolved");
  });
});
