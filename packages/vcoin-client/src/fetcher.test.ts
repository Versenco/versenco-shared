import { describe, it, expect, vi, afterEach } from "vitest";
import { functionUrl, vcoinFetch, genericErrorResult } from "./fetcher";
import { VCoinNetworkError } from "./types";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("functionUrl", () => {
  it("joins a base URL without a trailing slash", () => {
    expect(functionUrl("https://auth.versenco.com", "vcoin-earn")).toBe(
      "https://auth.versenco.com/functions/v1/vcoin-earn",
    );
  });

  it("strips a trailing slash from the base URL", () => {
    expect(functionUrl("https://auth.versenco.com/", "vcoin-earn")).toBe(
      "https://auth.versenco.com/functions/v1/vcoin-earn",
    );
  });

  it("throws if baseUrl is not https (and not localhost)", () => {
    expect(() => functionUrl("http://evil.example.com", "vcoin-earn")).toThrow(/https/);
  });

  it("allows http for localhost", () => {
    expect(functionUrl("http://localhost:54321", "vcoin-earn")).toBe("http://localhost:54321/functions/v1/vcoin-earn");
  });

  it("does not treat a lookalike hostname like localhost.evil.com as local", () => {
    // A prefix-only regex check would incorrectly allow this and send the
    // secret over plain HTTP to an attacker-controlled domain.
    expect(() => functionUrl("http://localhost.evil.com", "vcoin-earn")).toThrow(/https/);
  });

  it("throws for a malformed baseUrl", () => {
    expect(() => functionUrl("not a url", "vcoin-earn")).toThrow(/valid URL/);
  });
});

describe("vcoinFetch", () => {
  it("sends the method, headers, and JSON body, and parses a JSON response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ balance: 100 }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const raw = await vcoinFetch("https://x/y", {
      method: "POST",
      headers: { "x-vcoin-secret": "s3cr3t" },
      body: { user_id: "u1" },
    });

    expect(raw).toEqual({ status: 200, ok: true, json: { balance: 100 } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://x/y");
    expect(init.method).toBe("POST");
    expect(init.headers["x-vcoin-secret"]).toBe("s3cr3t");
    expect(JSON.parse(init.body)).toEqual({ user_id: "u1" });
  });

  it("handles an empty response body as {}", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 200 })));
    const raw = await vcoinFetch("https://x/y", { method: "GET", headers: {} });
    expect(raw).toEqual({ status: 200, ok: true, json: {} });
  });

  it("does not send a body for GET requests without one", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await vcoinFetch("https://x/y", { method: "GET", headers: {} });
    expect(fetchMock.mock.calls[0][1].body).toBeUndefined();
  });

  it("throws VCoinNetworkError when fetch itself rejects", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("DNS fail")));
    await expect(vcoinFetch("https://x/y", { method: "GET", headers: {} })).rejects.toBeInstanceOf(
      VCoinNetworkError,
    );
  });

  it("throws VCoinNetworkError when the response body is not valid JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>", { status: 200 })));
    await expect(vcoinFetch("https://x/y", { method: "GET", headers: {} })).rejects.toBeInstanceOf(
      VCoinNetworkError,
    );
  });

  it("throws VCoinNetworkError when the response body is valid JSON but not an object (e.g. an array or null)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("null", { status: 200 })));
    await expect(vcoinFetch("https://x/y", { method: "GET", headers: {} })).rejects.toBeInstanceOf(VCoinNetworkError);
  });
});

describe("genericErrorResult", () => {
  it("maps a known error code, with optional detail", () => {
    const result = genericErrorResult({
      status: 404,
      ok: false,
      json: { error: "wallet_not_found" },
    });
    expect(result).toEqual({ ok: false, error: "wallet_not_found", detail: undefined });
  });

  it("carries a detail string through when present", () => {
    const result = genericErrorResult({
      status: 500,
      ok: false,
      json: { error: "database_error", detail: "constraint violation" },
    });
    expect(result).toEqual({ ok: false, error: "database_error", detail: "constraint violation" });
  });

  it("throws VCoinNetworkError when the failed response has no error code", () => {
    expect(() => genericErrorResult({ status: 500, ok: false, json: {} })).toThrow(VCoinNetworkError);
  });

  it("maps a bare 401 (e.g. expired JWT rejected by the gateway) to invalid_token instead of throwing", () => {
    const result = genericErrorResult({ status: 401, ok: false, json: {} });
    expect(result).toEqual({ ok: false, error: "invalid_token", detail: undefined });
  });
});
