import { VCoinNetworkError, type VCoinBusinessError, type VCoinResult } from "./types";

export function functionUrl(baseUrl: string, fn: string): string {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error(`vCoin baseUrl must be a valid URL (got: ${baseUrl})`);
  }
  const isLocal =
    parsed.protocol === "http:" && (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1");
  if (parsed.protocol !== "https:" && !isLocal) {
    throw new Error(`vCoin baseUrl must use https:// (got: ${baseUrl})`);
  }
  return `${baseUrl.replace(/\/+$/, "")}/functions/v1/${fn}`;
}

export interface VCoinRawResponse {
  status: number;
  ok: boolean;
  json: Record<string, unknown>;
}

export const DEFAULT_TIMEOUT_MS = 30_000;

// Validated up front: setTimeout treats Infinity/NaN/0 as "fire immediately",
// which would turn a config typo into every request failing.
export function resolveTimeoutMs(timeoutMs: number | undefined): number {
  if (timeoutMs === undefined) return DEFAULT_TIMEOUT_MS;
  if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`vCoin timeoutMs must be a positive, finite number of milliseconds (got: ${String(timeoutMs)})`);
  }
  return timeoutMs;
}

export interface VCoinRequestInit {
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
}

export async function vcoinFetch(url: string, init: VCoinRequestInit): Promise<VCoinRawResponse> {
  const timeoutMs = init.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  let res: Response;
  let text: string;
  try {
    res = await fetch(url, {
      method: init.method,
      headers: { "Content-Type": "application/json", ...init.headers },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
    });
    // The timer must cover the body too: a server can send headers then stall.
    text = await res.text();
  } catch (err) {
    if (timedOut) {
      throw new VCoinNetworkError(`vCoin API request timed out after ${timeoutMs}ms`, undefined, err);
    }
    throw new VCoinNetworkError("Network error calling the vCoin API", undefined, err);
  } finally {
    clearTimeout(timer);
  }

  let json: Record<string, unknown>;
  try {
    json = text.length > 0 ? JSON.parse(text) : {};
  } catch (err) {
    throw new VCoinNetworkError("vCoin API returned a non-JSON response", res.status, err);
  }

  if (json === null || typeof json !== "object" || Array.isArray(json)) {
    throw new VCoinNetworkError("vCoin API returned a non-object JSON response", res.status);
  }

  return { status: res.status, ok: res.ok, json };
}

export function genericErrorResult<T>(raw: VCoinRawResponse): VCoinResult<T> {
  const code = typeof raw.json.error === "string" ? raw.json.error : undefined;
  if (!code) {
    if (raw.status === 401) {
      return { ok: false, error: "invalid_token", detail: undefined };
    }
    throw new VCoinNetworkError(`vCoin API returned ${raw.status} with no recognizable error code`, raw.status);
  }
  const detail = typeof raw.json.detail === "string" ? raw.json.detail : undefined;
  return { ok: false, error: code as VCoinBusinessError, detail };
}
