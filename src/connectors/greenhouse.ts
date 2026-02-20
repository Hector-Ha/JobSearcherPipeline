import { logger } from "../logger";
import { fetchWithRetry, type FetchResult } from "./base";
import type { RawJob, ConnectorResult } from "../types";
import type { SourceDefinition } from "../config";

interface GreenhouseLocation {
  name: string;
}

interface GreenhouseJob {
  id: number;
  title: string;
  updated_at: string;
  absolute_url: string;
  location: GreenhouseLocation;
  content?: string;
  departments?: Array<{ name: string }>;
}

interface GreenhouseResponse {
  jobs: GreenhouseJob[];
}

export async function fetchGreenhouseJobs(
  company: string,
  sourceConfig: SourceDefinition,
): Promise<ConnectorResult> {
  if (!sourceConfig.endpointTemplate) {
    throw new Error(
      `Missing endpointTemplate for Greenhouse config (company: ${company})`,
    );
  }

  const url =
    sourceConfig.endpointTemplate.replace("{company}", company) +
    "?content=true";

  const startTime = Date.now();

  const result: FetchResult<GreenhouseResponse> = await fetchWithRetry({
    url,
    timeoutMs: sourceConfig.timeoutMs,
    maxRetries: sourceConfig.rateLimiting?.maxRetries ?? 3,
    backoffStartMs: sourceConfig.rateLimiting?.backoffStartMs ?? 5000,
  });

  if (!result.success || !result.data) {
    return {
      source: "greenhouse",
      company,
      jobs: [],
      success: false,
      error: result.error,
      responseTimeMs: Date.now() - startTime,
      rateLimited: result.rateLimited,
    };
  }

  const jobs: RawJob[] = result.data.jobs.map((job) =>
    parseGreenhouseJob(job, company),
  );

  logger.debug(
    `Greenhouse/${company}: found ${jobs.length} jobs (${result.responseTimeMs}ms)`,
  );

  return {
    source: "greenhouse",
    company,
    jobs,
    success: true,
    responseTimeMs: result.responseTimeMs,
    rateLimited: result.rateLimited,
  };
}

function parseGreenhouseJob(job: GreenhouseJob, company: string): RawJob {
  return {
    source: "greenhouse",
    sourceJobId: String(job.id),
    title: job.title,
    company,
    url: job.absolute_url,
    locationRaw: job.location?.name ?? "",
    postedAt: job.updated_at ?? null,
    originalTimezone: null, // Greenhouse uses UTC
    content: job.content ?? "",
    rawPayload: JSON.stringify(job),
  };
}
