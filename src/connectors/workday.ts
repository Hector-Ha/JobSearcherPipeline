import { logger } from "../logger";
import { sleep } from "./base";
import { generateJobId } from "./page-parser-base";
import type { RawJob, ConnectorResult } from "../types";
import type { SourceDefinition } from "../config";

interface WorkdayPosting {
  id?: string;
  title?: string;
  externalPath?: string;
  locationsText?: string;
  postedOn?: string;
  bulletFields?: string[];
}

interface WorkdayResponse {
  jobPostings?: WorkdayPosting[];
}

interface WorkdayFetchResult {
  data: WorkdayResponse | null;
  success: boolean;
  error?: string;
  rateLimited: boolean;
  responseTimeMs: number;
}

export async function fetchWorkdayJobs(
  company: string,
  sourceConfig: SourceDefinition,
): Promise<ConnectorResult> {
  const startTime = Date.now();
  const boardUrl = resolveBoardUrl(company, sourceConfig);
  const base = parseBoardUrl(boardUrl);

  if (!base) {
    return {
      source: "workday",
      company,
      jobs: [],
      success: false,
      error: `Invalid Workday URL/token: ${company}`,
      responseTimeMs: Date.now() - startTime,
      rateLimited: false,
    };
  }

  const apiUrls = buildCandidateApiUrls(base.hostname, base.pathname, company);
  let lastError = "No valid Workday API endpoint";
  let rateLimited = false;

  for (const url of apiUrls) {
    const result = await fetchWorkdayApi(url, {
      timeoutMs: sourceConfig.timeoutMs,
      maxRetries: sourceConfig.rateLimiting?.maxRetries ?? 3,
      backoffStartMs: sourceConfig.rateLimiting?.backoffStartMs ?? 5000,
    });

    if (!result.success || !result.data) {
      lastError = result.error ?? lastError;
      rateLimited = rateLimited || result.rateLimited;
      continue;
    }

    const postings = result.data.jobPostings ?? [];
    const jobs: RawJob[] = postings.map((posting) =>
      parseWorkdayPosting(posting, company, base.hostname),
    );

    logger.debug(
      `Workday/${company}: found ${jobs.length} jobs (${result.responseTimeMs}ms)`,
    );

    return {
      source: "workday",
      company,
      jobs,
      success: true,
      responseTimeMs: result.responseTimeMs,
      rateLimited: result.rateLimited,
    };
  }

  return {
    source: "workday",
    company,
    jobs: [],
    success: false,
    error: lastError,
    responseTimeMs: Date.now() - startTime,
    rateLimited,
  };
}

function parseWorkdayPosting(
  posting: WorkdayPosting,
  company: string,
  hostname: string,
): RawJob {
  const title = posting.title?.trim() || "Untitled Role";
  const externalPath = posting.externalPath ?? "";
  const url = externalPath.startsWith("http")
    ? externalPath
    : `https://${hostname}${externalPath}`;

  const sourceJobId =
    posting.id?.trim() ||
    (externalPath ? externalPath.replace(/^\//, "") : "") ||
    generateJobId("workday", company, title);

  const postedAt = parseWorkdayPostedAt(posting.postedOn ?? "");
  const locationRaw = posting.locationsText?.trim() ?? "";
  const content = (posting.bulletFields ?? []).join(" | ");

  return {
    source: "workday",
    sourceJobId,
    title,
    company,
    url,
    locationRaw,
    postedAt,
    originalTimezone: null,
    content,
    rawPayload: JSON.stringify(posting),
  };
}

function parseWorkdayPostedAt(text: string): string | null {
  const value = text.trim();
  if (!value) return null;

  const parsed = Date.parse(value);
  if (!Number.isNaN(parsed)) {
    return new Date(parsed).toISOString();
  }

  const daysMatch = value.toLowerCase().match(/(\d+)\s+day/);
  if (daysMatch) {
    const days = Number.parseInt(daysMatch[1] ?? "0", 10);
    if (Number.isFinite(days)) {
      const d = new Date();
      d.setDate(d.getDate() - days);
      return d.toISOString();
    }
  }

  if (/today/i.test(value)) {
    return new Date().toISOString();
  }

  return null;
}

async function fetchWorkdayApi(
  url: string,
  options: {
    timeoutMs: number;
    maxRetries: number;
    backoffStartMs: number;
  },
): Promise<WorkdayFetchResult> {
  const start = Date.now();
  let lastError = "Unknown Workday error";
  let rateLimited = false;

  for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const controller = new AbortController();
      timeout = setTimeout(() => controller.abort(), options.timeoutMs);
      const response = await fetch(url, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": "JobSearchEngine/1.0",
        },
        body: JSON.stringify({ limit: 20, offset: 0 }),
      });

      if (response.status === 429) {
        rateLimited = true;
        lastError = "Workday rate limited";
        if (attempt < options.maxRetries) {
          await sleep(options.backoffStartMs * Math.pow(2, attempt));
          continue;
        }
        return {
          data: null,
          success: false,
          error: lastError,
          rateLimited: true,
          responseTimeMs: Date.now() - start,
        };
      }

      if (!response.ok) {
        lastError = `HTTP ${response.status}: ${response.statusText}`;
        if (response.status >= 500 && attempt < options.maxRetries) {
          await sleep(options.backoffStartMs * Math.pow(2, attempt));
          continue;
        }
        return {
          data: null,
          success: false,
          error: lastError,
          rateLimited,
          responseTimeMs: Date.now() - start,
        };
      }

      const data = (await response.json()) as WorkdayResponse;
      return {
        data,
        success: true,
        rateLimited,
        responseTimeMs: Date.now() - start,
      };
    } catch (error) {
      const isAbort = error instanceof Error && error.name === "AbortError";
      lastError = isAbort
        ? `Timeout after ${options.timeoutMs}ms`
        : String(error);
      if (attempt < options.maxRetries) {
        await sleep(options.backoffStartMs * Math.pow(2, attempt));
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
    responseTimeMs: Date.now() - start,
  };
}

function resolveBoardUrl(
  company: string,
  sourceConfig: SourceDefinition,
): string {
  if (/^https?:\/\//i.test(company)) {
    return company;
  }
  if (company.includes(".myworkdayjobs.com")) {
    return `https://${company}`;
  }
  return sourceConfig.urlTemplate!.replace("{company}", company);
}

function parseBoardUrl(
  boardUrl: string,
): { hostname: string; pathname: string } | null {
  try {
    const parsed = new URL(boardUrl);
    return { hostname: parsed.hostname, pathname: parsed.pathname };
  } catch {
    return null;
  }
}

function buildCandidateApiUrls(
  hostname: string,
  pathname: string,
  company: string,
): string[] {
  const tenant = hostname.split(".")[0] ?? "";
  const pathParts = pathname.split("/").filter(Boolean);
  const siteCandidates = pathParts
    .filter((part) => !/^[a-z]{2}-[A-Z]{2}$/i.test(part))
    .filter((part) => part.toLowerCase() !== "job")
    .slice(-2);

  siteCandidates.push("careers", "external", "jobs");

  const uniqueSites = [...new Set(siteCandidates)];
  const urls = uniqueSites.map(
    (site) => `https://${hostname}/wday/cxs/${tenant}/${site}/jobs`,
  );

  if (company.includes("/") && company.includes(".myworkdayjobs.com")) {
    const tokenParts = company.split("/").filter(Boolean);
    const maybeSite = tokenParts[tokenParts.length - 1];
    if (maybeSite) {
      urls.unshift(`https://${hostname}/wday/cxs/${tenant}/${maybeSite}/jobs`);
    }
  }

  return [...new Set(urls)];
}
