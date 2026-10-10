export const DEFAULT_RESPONSE_START_TIMEOUT_SECONDS = 180;
export const MIN_RESPONSE_START_TIMEOUT_SECONDS = 1;
export const MAX_RESPONSE_START_TIMEOUT_SECONDS = 3600;

export function normalizeResponseStartTimeoutSeconds(value: unknown): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_RESPONSE_START_TIMEOUT_SECONDS;
  return Math.min(MAX_RESPONSE_START_TIMEOUT_SECONDS, Math.max(MIN_RESPONSE_START_TIMEOUT_SECONDS, Math.round(parsed)));
}

export async function fetchWithResponseStartTimeout(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  timeoutSeconds: unknown,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): Promise<Response> {
  const seconds = normalizeResponseStartTimeoutSeconds(timeoutSeconds);
  const request = new Request(input, init);
  const controller = new AbortController();
  let timedOut = false;
  let responseStarted = false;

  const abortFromCaller = () => controller.abort();
  if (request.signal.aborted) {
    controller.abort();
  } else {
    request.signal.addEventListener("abort", abortFromCaller, { once: true });
  }

  const timer = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, seconds * 1000);

  try {
    // fetch() resolves when response headers are available. Clearing the timer
    // immediately after this await means long-running SSE streams are not capped.
    const response = await fetchImpl(request, { signal: controller.signal });
    responseStarted = true;
    return response;
  } catch (error) {
    if (timedOut) {
      throw new Error(`Timed out waiting for response to start after ${seconds} seconds`);
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timer);
    // If fetch failed before headers, nothing remains to abort and the listener can
    // be removed. Once streaming has started, keep caller -> controller propagation
    // alive so the Agent's Stop/Abort action can still terminate the response body.
    if (!responseStarted) {
      request.signal.removeEventListener("abort", abortFromCaller);
    }
  }
}

export function createResponseStartTimeoutFetch(timeoutSeconds: unknown): typeof globalThis.fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) =>
    fetchWithResponseStartTimeout(input, init, timeoutSeconds)) as typeof globalThis.fetch;
}
