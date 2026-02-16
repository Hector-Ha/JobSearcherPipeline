import { logger } from "../logger";
import { fetchWithRetry, type FetchResult } from "./base";
import type { RawJob, ConnectorResult } from "../types";
import type { SourceDefinition } from "../config";

interface LeverCategories {
  commitment?: string;
  department?: string;
  location?: string;
  team?: string;
  allLocations?: string[];
}

interface LeverJob {
  id: string;
  text: string;
  hostedUrl: string;
  applyUrl: string;
  createdAt: number; // Unix timestamp in ms
  categories: LeverCategories;
  descriptionPlain?: string;
  description?: string;
  additionalPlain?: string;
  workplaceType?: string; // "unspecified" | "on-site" | "remote" | "hybrid"
}

// Fetch Jobs

export async function fetchLeverJobs(
  company: string,
  sourceConfig: SourceDefinition,
): Promise<ConnectorResult> {
  const url = sourceConfig.endpointTemplate!.replace("{company}", company);
  const startTime = Date.now();

  const result: FetchResult<LeverJob[]> = await fetchWithRetry({
    url,
    timeoutMs: sourceConfig.timeoutMs,
    maxRetries: sourceConfig.rateLimiting?.maxRetries ?? 3,
    backoffStartMs: sourceConfig.rateLimiting?.backoffStartMs ?? 5000,
  });

  if (!result.success || !result.data) {
    return {
      source: "lever",
      company,
      jobs: [],
      success: false,
      error: result.error,
      responseTimeMs: Date.now() - startTime,
      rateLimited: result.rateLimited,
    };
  }

  const jobs: RawJob[] = result.data.map((job) => parseLeverJob(job, company));

  logger.debug(
    `Lever/${company}: found ${jobs.length} jobs (${result.responseTimeMs}ms)`,
  );

  return {
    source: "lever",
    company,
    jobs,
    success: true,
    responseTimeMs: result.responseTimeMs,
    rateLimited: result.rateLimited,
  };
}

// Parse Single Job

function parseLeverJob(job: LeverJob, company: string): RawJob {
  // Build location from categories
  const locationParts: string[] = [];
  if (job.categories?.location) {
    locationParts.push(job.categories.location);
  }
  if (job.categories?.allLocations) {
    locationParts.push(...job.categories.allLocations);
  }

  // Add workplace type info to location for mode classification
  let locationRaw = [...new Set(locationParts)].join(", ");
  if (job.workplaceType && job.workplaceType !== "unspecified") {
    locationRaw += locationRaw ? ` (${job.workplaceType})` : job.workplaceType;
  }

  const content = [
    job.descriptionPlain ?? job.description ?? "",
    job.additionalPlain ?? "",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    source: "lever",
    sourceJobId: job.id,
    title: job.text,
    company,
    url: job.hostedUrl,
    locationRaw,
    postedAt: job.createdAt ? new Date(job.createdAt).toISOString() : null,
    originalTimezone: null, // Lever uses UTC timestamps
    content,
    rawPayload: JSON.stringify(job),
  };
}
