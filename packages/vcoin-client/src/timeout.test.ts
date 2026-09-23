import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { vcoinFetch, resolveTimeoutMs, DEFAULT_TIMEOUT_MS } from "./fetcher";
import { createVCoinServerClient } from "./server";
import { createVCoinUserClient } from "./user";
import { VCoinNetworkError } from "./types";

type FetchInit = { signal?: AbortSignal };

function abortError() {
  return new DOMException("aborted", "AbortError");
}

// Never answers on its own, but honors the abort signal like the real fetch.
function hangingFetch() {
  return vi.fn(
    (_url: string, init?: FetchInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(abortError()));
      }),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("vcoinFetch timeout", () => {
  it("aborts a request that outlives timeoutMs and throws a VCoinNetworkError", async () => {
    vi.stubGlobal("fetch", hangingFetch());
    const request = vcoinFetch("https://x/y", { method: "GET", headers: {}, timeoutMs: 1000 });
    const assertion = expect(request).rejects.toThrow(/timed out after 1000ms/);
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
    await expect(request).rejects.toBeInstanceOf(VCoinNetworkError);
  });

  it("does not time out a request that answers in time", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));
    const raw = await vcoinFetch("https://x/y", { method: "GET", headers: {}, timeoutMs: 1000 });
    expect(raw.ok).toBe(true);
  });

  it("hands fetch an AbortSignal", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await vcoinFetch("https://x/y", { method: "GET", headers: {}, timeoutMs: 1000 });
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it("clears its timer once the request completes", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));
    await vcoinFetch("https://x/y", { method: "GET", headers: {}, timeoutMs: 1000 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("also covers a body that never finishes arriving", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: FetchInit) =>
        Promise.resolve({
          status: 200,
          ok: true,
          text: () =>
            new Promise<string>((_resolve, reject) => {
              init?.signal?.addEventListener("abort", () => reject(abortError()));
            }),
        }),
      ),
    );
    const request = vcoinFetch("https://x/y", { method: "GET", headers: {}, timeoutMs: 500 });
    const assertion = expect(request).rejects.toThrow(/timed out after 500ms/);
    await vi.advanceTimersByTimeAsync(500);
    await assertion;
  });

  it("wraps a non-timeout failure while reading the body as a network error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ status: 200, ok: true, text: () => Promise.reject(new Error("socket hang up")) }),
    );
    const request = vcoinFetch("https://x/y", { method: "GET", headers: {}, timeoutMs: 1000 });
    await expect(request).rejects.toBeInstanceOf(VCoinNetworkError);
    await expect(request).rejects.toThrow(/Network error/);
  });

  it("applies the default timeout when none is given", async () => {
    vi.stubGlobal("fetch", hangingFetch());
    const request = vcoinFetch("https://x/y", { method: "GET", headers: {} });
    const assertion = expect(request).rejects.toThrow(new RegExp(`timed out after ${DEFAULT_TIMEOUT_MS}ms`));
    await vi.advanceTimersByTimeAsync(DEFAULT_TIMEOUT_MS);
    await assertion;
  });
});

describe("resolveTimeoutMs", () => {
  it("defaults to 30 seconds", () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(30_000);
    expect(resolveTimeoutMs(undefined)).toBe(30_000);
  });

  it("accepts a positive finite number", () => {
    expect(resolveTimeoutMs(5000)).toBe(5000);
  });

  it.each([0, -1, NaN, Infinity, "5000" as unknown as number])("rejects %s", (bad) => {
    expect(() => resolveTimeoutMs(bad)).toThrow(/timeoutMs/);
  });
});

describe("client timeoutMs option", () => {
  const server = (timeoutMs?: number) =>
    createVCoinServerClient({ appId: "app", clientSecret: "s", baseUrl: "https://x", timeoutMs });
  const user = (timeoutMs?: number) => createVCoinUserClient({ baseUrl: "https://x", timeoutMs });

  it("server client times out after the configured duration", async () => {
    vi.stubGlobal("fetch", hangingFetch());
    const call = server(50).balance({ userId: "u" });
    const assertion = expect(call).rejects.toBeInstanceOf(VCoinNetworkError);
    await vi.advanceTimersByTimeAsync(50);
    await assertion;
  });

  it("user client times out after the configured duration", async () => {
    vi.stubGlobal("fetch", hangingFetch());
    const call = user(50).balance({ accessToken: "t" });
    const assertion = expect(call).rejects.toBeInstanceOf(VCoinNetworkError);
    await vi.advanceTimersByTimeAsync(50);
    await assertion;
  });

  it("both clients fall back to the default timeout", async () => {
    vi.stubGlobal("fetch", hangingFetch());
    const a = expect(server().getConfig()).rejects.toThrow(new RegExp(`${DEFAULT_TIMEOUT_MS}ms`));
    const b = expect(user().balance({ accessToken: "t" })).rejects.toThrow(new RegExp(`${DEFAULT_TIMEOUT_MS}ms`));
    await vi.advanceTimersByTimeAsync(DEFAULT_TIMEOUT_MS);
    await a;
    await b;
  });

  it("rejects an invalid timeoutMs when the client is created", () => {
    expect(() => server(0)).toThrow(/timeoutMs/);
    expect(() => user(-5)).toThrow(/timeoutMs/);
  });
});
