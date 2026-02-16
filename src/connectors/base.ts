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
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          "User-Agent": "JobSearchEngine/1.0",
        },
      });

      clearTimeout(timeout);

      // Handle rate limiting (429)
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

      // Handle server errors (5xx)
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

      // Handle other HTTP errors
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

      // Parse JSON response
      const data = (await response.json()) as T;

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

// Batch Fetch

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

  // Process in batches
  for (let i = 0; i < items.length; i += rateLimiting.batchSize) {
    const batch = items.slice(i, i + rateLimiting.batchSize);

    // Process each item in the batch with delay between requests
    for (const item of batch) {
      const result = await fetchFn(item);
      results.push(result);
      completed++;

      onProgress?.(completed, items.length);

      // Delay between individual requests within batch
      if (completed < items.length) {
        await sleep(rateLimiting.delayBetweenRequestsMs);
      }
    }

    // Pause between batches
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

// Utility

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
