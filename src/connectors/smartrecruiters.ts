import { logger } from "../logger";
import { fetchWithRetry, type FetchResult } from "./base";
import type { RawJob, ConnectorResult } from "../types";
import type { SourceDefinition } from "../config";
import { generateJobId } from "./page-parser-base";

interface SmartRecruitersPosting {
  id: string;
  name: string;
  releasedDate?: string;
  location?: {
    city?: string;
    region?: string;
    country?: string;
  };
  ref?: string;
  typeOfEmployment?: {
    label?: string;
  };
}

interface SmartRecruitersResponse {
  content?: SmartRecruitersPosting[];
}

export async function fetchSmartRecruitersJobs(
  company: string,
  sourceConfig: SourceDefinition,
): Promise<ConnectorResult> {
  const url = sourceConfig.endpointTemplate!.replace("{company}", company);
  const startTime = Date.now();

  const result: FetchResult<SmartRecruitersResponse> = await fetchWithRetry({
    url,
    timeoutMs: sourceConfig.timeoutMs,
    maxRetries: sourceConfig.rateLimiting?.maxRetries ?? 3,
    backoffStartMs: sourceConfig.rateLimiting?.backoffStartMs ?? 5000,
  });

  if (!result.success || !result.data) {
    return {
      source: "smartrecruiters",
      company,
      jobs: [],
      success: false,
      error: result.error,
      responseTimeMs: Date.now() - startTime,
      rateLimited: result.rateLimited,
    };
  }

  const jobs: RawJob[] = (result.data.content ?? []).map((posting) =>
    parseSmartRecruitersPosting(posting, company),
  );

  logger.debug(
    `SmartRecruiters/${company}: found ${jobs.length} jobs (${result.responseTimeMs}ms)`,
  );

  return {
    source: "smartrecruiters",
    company,
    jobs,
    success: true,
    responseTimeMs: result.responseTimeMs,
    rateLimited: result.rateLimited,
  };
}

function parseSmartRecruitersPosting(
  posting: SmartRecruitersPosting,
  company: string,
): RawJob {
  const title = posting.name?.trim() || "Untitled Role";
  const sourceJobId =
    posting.id || generateJobId("smartrecruiters", company, title);
  const url = `https://jobs.smartrecruiters.com/${company}/${sourceJobId}`;
  const locationParts = [
    posting.location?.city,
    posting.location?.region,
    posting.location?.country,
  ].filter((v): v is string => !!v && v.trim().length > 0);
  const locationRaw = locationParts.join(", ");

  return {
    source: "smartrecruiters",
    sourceJobId,
    title,
    company,
    url,
    locationRaw,
    postedAt: posting.releasedDate ?? null,
    originalTimezone: null,
    content: posting.typeOfEmployment?.label ?? posting.ref ?? title,
    rawPayload: JSON.stringify(posting),
  };
}
