const DEFAULT_TIMEOUT_MS = 12_000;
// Retry transient provider failures (429/5xx/timeouts/network) with exponential
// backoff so a momentary blip doesn't drop a provider's whole inventory.
const DEFAULT_MAX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 400;
const RETRY_JITTER_MS = 250;

export async function jsonFetch(url, options = {}) {
  const { timeoutMs: requestedTimeoutMs, maxRetries: requestedMaxRetries, ...fetchOptions } = options;
  const timeoutMs = Number(requestedTimeoutMs || DEFAULT_TIMEOUT_MS);
  const maxRetries = Number.isFinite(Number(requestedMaxRetries)) ? Number(requestedMaxRetries) : DEFAULT_MAX_RETRIES;

  let attempt = 0;
  for (;;) {
    try {
      return await jsonFetchOnce(url, fetchOptions, timeoutMs);
    } catch (error) {
      if (attempt >= maxRetries || !isRetryableFetchError(error)) throw error;
      const wait = Number.isFinite(error?.retryAfterMs) ? error.retryAfterMs : retryBackoffMs(attempt);
      await sleep(wait);
      attempt += 1;
    }
  }
}

async function jsonFetchOnce(url, fetchOptions, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(fetchOptions.headers || {})
      },
      body: fetchOptions.body
    });
    if (!response.ok) {
      const error = new Error(`${response.status} ${response.statusText}`);
      error.status = response.status;
      const retryAfterMs = parseRetryAfterMs(response.headers?.get?.("retry-after"));
      if (retryAfterMs != null) error.retryAfterMs = retryAfterMs;
      throw error;
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

// Transient failures we should retry instead of dropping a provider's inventory:
// rate limits (429), server errors (5xx), request timeouts (AbortError), and
// network/DNS/connection errors (fetch throws a TypeError). Client errors (4xx
// other than 429) and parse errors are not retried.
function isRetryableFetchError(error) {
  if (!error) return false;
  if (typeof error.status === "number") return error.status === 429 || (error.status >= 500 && error.status < 600);
  if (error.name === "AbortError") return true;
  if (error instanceof TypeError) return true;
  return false;
}

function retryBackoffMs(attempt) {
  const base = RETRY_BASE_DELAY_MS * 2 ** attempt;
  return base + Math.floor(Math.random() * RETRY_JITTER_MS);
}

function parseRetryAfterMs(headerValue) {
  if (!headerValue) return null;
  const seconds = Number(headerValue);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const dateMs = Date.parse(headerValue);
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());
  return null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

export async function safeJsonFetch(url, options = {}) {
  try {
    return await jsonFetch(url, options);
  } catch {
    return null;
  }
}

// Shared with the provider crawlers — keep a single definition in core.
export { pickArray } from "../../core/format.js";
