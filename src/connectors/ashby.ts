import { logger } from "../logger";
import { fetchWithRetry, type FetchResult } from "./base";
import type { RawJob, ConnectorResult } from "../types";
import type { SourceDefinition } from "../config";

interface AshbyLocation {
  city?: string;
  state?: string;
  country?: string;
  isRemote?: boolean;
}

interface AshbyJob {
  id: string;
  title: string;
  publishedAt: string; // ISO 8601
  updatedAt?: string;
  location: string; // Display string
  locationIds?: string[];
  secondaryLocations?: AshbyLocation[];
  departmentName?: string;
  teamName?: string;
  employmentType?: string;
  jobUrl: string;
  descriptionHtml?: string;
  descriptionPlain?: string;
  isRemote?: boolean;
  compensationTierSummary?: string;
}

interface AshbyResponse {
  jobs: AshbyJob[];
  apiVersion?: string;
}

export async function fetchAshbyJobs(
  company: string,
  sourceConfig: SourceDefinition,
): Promise<ConnectorResult> {
  const url = sourceConfig.endpointTemplate!.replace("{company}", company);
  const startTime = Date.now();

  const result: FetchResult<AshbyResponse> = await fetchWithRetry({
    url,
    timeoutMs: sourceConfig.timeoutMs,
    maxRetries: sourceConfig.rateLimiting?.maxRetries ?? 3,
    backoffStartMs: sourceConfig.rateLimiting?.backoffStartMs ?? 5000,
  });

  if (!result.success || !result.data) {
    return {
      source: "ashby",
      company,
      jobs: [],
      success: false,
      error: result.error,
      responseTimeMs: Date.now() - startTime,
      rateLimited: result.rateLimited,
    };
  }

  const jobs: RawJob[] = result.data.jobs.map((job) =>
    parseAshbyJob(job, company),
  );

  logger.debug(
    `Ashby/${company}: found ${jobs.length} jobs (${result.responseTimeMs}ms)`,
  );

  return {
    source: "ashby",
    company,
    jobs,
    success: true,
    responseTimeMs: result.responseTimeMs,
    rateLimited: result.rateLimited,
  };
}

function parseAshbyJob(job: AshbyJob, company: string): RawJob {
  let locationRaw = job.location ?? "";
  if (job.isRemote) {
    locationRaw += locationRaw ? " (remote)" : "remote";
  }

  return {
    source: "ashby",
    sourceJobId: job.id,
    title: job.title,
    company,
    url: job.jobUrl,
    locationRaw,
    postedAt: job.publishedAt ?? null,
    originalTimezone: null,
    content: job.descriptionPlain ?? job.descriptionHtml ?? "",
    rawPayload: JSON.stringify(job),
  };
}
