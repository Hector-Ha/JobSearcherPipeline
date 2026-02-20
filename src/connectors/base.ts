import { logger } from "../logger";
import type { RateLimiting } from "../config";

export interface FetchWithRetryOptions {
  url: string;
  timeoutMs: number;
  maxRetries: number;
  backoffStartMs: number;
  signal?: AbortSignal;
}

export interface FetchResult<T> {
  data: T | null;
  success: boolean;
  error?: string;
  rateLimited: boolean;
  responseTimeMs: number;
  statusCode?: number;
}

export async function fetchWithRetry<T>(
  options: FetchWithRetryOptions,
): Promise<FetchResult<T>> {
  const { url, timeoutMs, maxRetries, backoffStartMs } = options;
  let lastError = "";
  let rateLimited = false;
  const startTime = Date.now();

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const controller = new AbortController();
      timeout = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          "User-Agent": "JobSearchEngine/1.0",
        },
      });

      if (response.status === 429) {
        rateLimited = true;
        const retryAfter = response.headers.get("Retry-After");
        const waitMs = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : backoffStartMs * Math.pow(2, attempt);

        logger.warn(
          `Rate limited (429) on ${url} — waiting ${waitMs}ms (attempt ${attempt + 1}/${maxRetries + 1})`,
        );

        if (attempt < maxRetries) {
          await sleep(waitMs);
          continue;
        }

        return {
          data: null,
          success: false,
          error: `Rate limited after ${maxRetries + 1} attempts`,
          rateLimited: true,
          responseTimeMs: Date.now() - startTime,
          statusCode: 429,
        };
      }

      if (response.status >= 500) {
        lastError = `Server error: ${response.status} ${response.statusText}`;
        logger.warn(
          `${lastError} on ${url} (attempt ${attempt + 1}/${maxRetries + 1})`,
        );

        if (attempt < maxRetries) {
          const waitMs = backoffStartMs * Math.pow(2, attempt);
          await sleep(waitMs);
          continue;
        }

        return {
          data: null,
          success: false,
          error: lastError,
          rateLimited: false,
          responseTimeMs: Date.now() - startTime,
          statusCode: response.status,
        };
      }

      if (!response.ok) {
        return {
          data: null,
          success: false,
          error: `HTTP ${response.status}: ${response.statusText}`,
          rateLimited: false,
          responseTimeMs: Date.now() - startTime,
          statusCode: response.status,
        };
      }

      // Parse JSON response - THIS IS WHERE IT COULD HANG if timeout was already cleared
      const data = (await response.json()) as T;

      clearTimeout(timeout); // NOW it is safe to clear timeout

      return {
        data,
        success: true,
        rateLimited: false,
        responseTimeMs: Date.now() - startTime,
        statusCode: response.status,
      };
    } catch (error) {
      const isAbort = error instanceof Error && error.name === "AbortError";
      lastError = isAbort ? `Timeout after ${timeoutMs}ms` : String(error);

      logger.warn(
        `Fetch error on ${url}: ${lastError} (attempt ${attempt + 1}/${maxRetries + 1})`,
      );

      if (attempt < maxRetries) {
        const waitMs = backoffStartMs * Math.pow(2, attempt);
        await sleep(waitMs);
        continue;
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    data: null,
    success: false,
    error: lastError,
    rateLimited,
    responseTimeMs: Date.now() - startTime,
  };
}

export interface BatchFetchOptions<T> {
  items: string[];
  fetchFn: (item: string) => Promise<T>;
  rateLimiting: RateLimiting;
  onProgress?: (completed: number, total: number) => void;
}

export async function batchFetch<T>(
  options: BatchFetchOptions<T>,
): Promise<T[]> {
  const { items, fetchFn, rateLimiting, onProgress } = options;
  const results: T[] = [];
  let completed = 0;

  for (let i = 0; i < items.length; i += rateLimiting.batchSize) {
    const batch = items.slice(i, i + rateLimiting.batchSize);

    for (let j = 0; j < batch.length; j++) {
      const item = batch[j];
      try {
        const result = await fetchFn(item);
        results.push(result);
      } catch (e) {
        logger.error(`Batch item failed: ${item} - ${e}`);
      }

      completed += 1;
      onProgress?.(completed, items.length);

      const isLastInBatch = j === batch.length - 1;
      if (!isLastInBatch && rateLimiting.delayBetweenRequestsMs > 0) {
        await sleep(rateLimiting.delayBetweenRequestsMs);
      }
    }

    const nextBatchStart = i + rateLimiting.batchSize;
    if (nextBatchStart < items.length) {
      logger.debug(
        `Batch pause: ${rateLimiting.batchPauseMs}ms before next batch (${nextBatchStart}/${items.length})`,
      );
      await sleep(rateLimiting.batchPauseMs);
    }
  }

  return results;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
