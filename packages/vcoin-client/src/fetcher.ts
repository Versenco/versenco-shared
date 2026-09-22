import { VCoinNetworkError, type VCoinResult } from "./types";

export function functionUrl(baseUrl: string, fn: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/functions/v1/${fn}`;
}

export interface VCoinRawResponse {
  status: number;
  ok: boolean;
  json: Record<string, unknown>;
}

export async function vcoinFetch(
  url: string,
  init: { method: "GET" | "POST"; headers: Record<string, string>; body?: unknown },
): Promise<VCoinRawResponse> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method,
      headers: { "Content-Type": "application/json", ...init.headers },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch (err) {
    throw new VCoinNetworkError("Network error calling the vCoin API", undefined, err);
  }

  const text = await res.text();
  let json: Record<string, unknown>;
  try {
    json = text.length > 0 ? JSON.parse(text) : {};
  } catch (err) {
    throw new VCoinNetworkError("vCoin API returned a non-JSON response", res.status, err);
  }

  return { status: res.status, ok: res.ok, json };
}

export function genericErrorResult<T>(raw: VCoinRawResponse): VCoinResult<T> {
  const code = typeof raw.json.error === "string" ? raw.json.error : undefined;
  if (!code) {
    throw new VCoinNetworkError(`vCoin API returned ${raw.status} with no recognizable error code`, raw.status);
  }
  const detail = typeof raw.json.detail === "string" ? raw.json.detail : undefined;
  return { ok: false, error: code, detail };
}
