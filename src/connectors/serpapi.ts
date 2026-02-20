import { logger } from "../logger";
import { getConfig } from "../config";

interface SerpApiParams {
  engine: string;
  q: string;
  num?: number;
  [key: string]: any;
}

export interface SerpApiResult {
  error?: string;
  search_metadata: {
    id: string;
    status: string;
    json_endpoint: string;
    created_at: string;
    processed_at: string;
    google_url: string;
    raw_html_file: string;
    total_time_taken: number;
  };
  search_parameters: {
    engine: string;
    q: string;
    google_domain: string;
    num: string;
  };
  organic_results?: Array<{
    position: number;
    title: string;
    link: string;
    displayed_link: string;
    snippet: string;
    [key: string]: any;
  }>;
}

/**
 * Rotates through available SerpApi keys to find a working one.
 */
export async function serpApiSearch(
  params: SerpApiParams,
): Promise<SerpApiResult> {
  const config = getConfig();
  const keys = config.env.serpApiKeys;

  if (keys.length === 0) {
    throw new Error("No SerpApi keys configured");
  }

  // Shuffle keys fully for this request
  const shuffledKeys = [...keys].sort(() => Math.random() - 0.5);

  // Log the attempt order (truncated)
  const keySuffixes = shuffledKeys.map((k) => "..." + k.slice(-4));
  logger.debug(
    `SerpApi: request will try up to ${keys.length} keys [${keySuffixes.join(", ")}]`,
  );

  let lastError: Error | null = null;
  let attemptCount = 0;

  for (const key of shuffledKeys) {
    attemptCount++;
    const keySuffix = key.slice(-4);

    // If this is a retry (not the first attempt), add a small delay
    if (attemptCount > 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    try {
      const url = new URL("https://serpapi.com/search.json");
      url.searchParams.set("api_key", key);

      for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, String(v));
      }

      const res = await fetch(url.toString());

      if (!res.ok) {
        const text = await res.text();
        if (res.status === 401 || res.status === 403 || res.status === 429) {
          logger.warn(
            `SerpApi key ...${keySuffix} failed (${res.status}), trying next key (${attemptCount}/${keys.length})`,
          );
          lastError = new Error(`SerpApi error ${res.status}: ${text}`);
          continue;
        }
        logger.warn(
          `SerpApi key ...${keySuffix} error ${res.status}, trying next key (${attemptCount}/${keys.length})`,
        );
        lastError = new Error(`SerpApi error ${res.status}: ${text}`);
        continue;
      }

      const data = (await res.json()) as SerpApiResult;

      if (data.error) {
        logger.warn(
          `SerpApi key ...${keySuffix} returned error: ${data.error}, trying next key (${attemptCount}/${keys.length})`,
        );
        lastError = new Error(String(data.error));
        continue;
      }

      logger.debug(`SerpApi: success with key ...${keySuffix}`);
      return data;
    } catch (err) {
      logger.warn(
        `SerpApi key ...${keySuffix} request failed: ${err}, trying next key (${attemptCount}/${keys.length})`,
      );
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  logger.error(`SerpApi: all ${keys.length} keys exhausted`);
  throw lastError || new Error("All SerpApi keys failed or exhausted");
}
