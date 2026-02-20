import * as cheerio from "cheerio";
import { logger } from "../logger";
import { sleep } from "./base";
import type { RawJob, ConnectorResult } from "../types";
import type { SourceDefinition } from "../config";

export interface PageParserConfig {
  source: string;
  company: string;
  url: string;
  timeoutMs: number;
  maxRetries: number;
  backoffStartMs: number;
}

export interface ParsedJob {
  sourceJobId: string;
  title: string;
  url: string;
  locationRaw: string;
  postedAt: string | null;
  content: string;
}

export interface PageFetchResult {
  html: string | null;
  success: boolean;
  error?: string;
  responseTimeMs: number;
  statusCode?: number;
}

async function fetchHtml(config: PageParserConfig): Promise<PageFetchResult> {
  const { url, timeoutMs, maxRetries, backoffStartMs } = config;
  let lastError = "";
  const startTime = Date.now();

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: "text/html,application/xhtml+xml,text/xml;q=0.9,*/*;q=0.8",
          "User-Agent": "Mozilla/5.0 (compatible; JobSearchEngine/1.0)",
        },
      });

      if (response.status === 429) {
        clearTimeout(timeout);
        const waitMs = backoffStartMs * Math.pow(2, attempt);
        logger.warn(`Rate limited (429) on ${url} — waiting ${waitMs}ms`);
        if (attempt < maxRetries) {
          await sleep(waitMs);
          continue;
        }
        return {
          html: null,
          success: false,
          error: "Rate limited",
          responseTimeMs: Date.now() - startTime,
          statusCode: 429,
        };
      }

      if (response.status >= 500) {
        clearTimeout(timeout);
        lastError = `Server error: ${response.status}`;
        if (attempt < maxRetries) {
          await sleep(backoffStartMs * Math.pow(2, attempt));
          continue;
        }
        return {
          html: null,
          success: false,
          error: lastError,
          responseTimeMs: Date.now() - startTime,
          statusCode: response.status,
        };
      }

      if (!response.ok) {
        clearTimeout(timeout);
        return {
          html: null,
          success: false,
          error: `HTTP ${response.status}`,
          responseTimeMs: Date.now() - startTime,
          statusCode: response.status,
        };
      }

      const html = await response.text();
      clearTimeout(timeout);

      return {
        html,
        success: true,
        responseTimeMs: Date.now() - startTime,
        statusCode: response.status,
      };
    } catch (error) {
      const isAbort = error instanceof Error && error.name === "AbortError";
      lastError = isAbort ? `Timeout after ${timeoutMs}ms` : String(error);

      if (attempt < maxRetries) {
        await sleep(backoffStartMs * Math.pow(2, attempt));
        continue;
      }
    }
  }

  return {
    html: null,
    success: false,
    error: lastError,
    responseTimeMs: Date.now() - startTime,
  };
}

export function createPageParserResult(
  source: string,
  company: string,
  jobs: ParsedJob[],
  startTime: number,
): ConnectorResult {
  const rawJobs: RawJob[] = jobs.map((job) => ({
    source,
    sourceJobId: job.sourceJobId,
    title: job.title,
    company,
    url: job.url,
    locationRaw: job.locationRaw,
    postedAt: job.postedAt,
    originalTimezone: null,
    content: job.content,
    rawPayload: JSON.stringify(job),
  }));

  return {
    source,
    company,
    jobs: rawJobs,
    success: true,
    responseTimeMs: Date.now() - startTime,
    rateLimited: false,
  };
}

export function createPageParserError(
  source: string,
  company: string,
  error: string,
  startTime: number,
): ConnectorResult {
  return {
    source,
    company,
    jobs: [],
    success: false,
    error,
    responseTimeMs: Date.now() - startTime,
    rateLimited: false,
  };
}

export function loadCheerio(html: string): cheerio.CheerioAPI {
  return cheerio.load(html);
}

export function extractText($: cheerio.CheerioAPI, selector: string): string {
  return $(selector).text().trim();
}

export function extractAttribute(
  $: cheerio.CheerioAPI,
  selector: string,
  attr: string,
): string {
  return $(selector).attr(attr) ?? "";
}

export function cleanText(text: string): string {
  return text.replace(/\s+/g, " ").replace(/\n+/g, " ").trim();
}

export function generateJobId(source: string, ...parts: string[]): string {
  const hash = parts
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "");
  return `${source}-${hash}`;
}

export interface SelectorFingerprint {
  source: string;
  selectors: Record<string, string>;
  sampleUrl?: string;
}

export function validateSelectors(
  $: cheerio.CheerioAPI,
  selectors: Record<string, string>,
): { valid: boolean; missing: string[] } {
  const missing: string[] = [];

  for (const [name, selector] of Object.entries(selectors)) {
    if ($(selector).length === 0) {
      missing.push(name);
    }
  }

  return {
    valid: missing.length === 0,
    missing,
  };
}

export async function fetchPageParserJobs(
  source: string,
  company: string,
  sourceConfig: SourceDefinition,
  parseFn: (html: string, company: string, url: string) => ParsedJob[],
): Promise<ConnectorResult> {
  const startTime = Date.now();

  const url = sourceConfig.urlTemplate!.replace("{company}", company);

  const result = await fetchHtml({
    source,
    company,
    url,
    timeoutMs: sourceConfig.timeoutMs,
    maxRetries: 3,
    backoffStartMs: 5000,
  });

  if (!result.success || !result.html) {
    return createPageParserError(
      source,
      company,
      result.error ?? "Unknown error",
      startTime,
    );
  }

  try {
    const jobs = parseFn(result.html, company, url);

    logger.debug(
      `${source}/${company}: parsed ${jobs.length} jobs (${result.responseTimeMs}ms)`,
    );

    return createPageParserResult(source, company, jobs, startTime);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error(`${source}/${company}: parse error: ${errorMsg}`);
    return createPageParserError(
      source,
      company,
      `Parse error: ${errorMsg}`,
      startTime,
    );
  }
}
