import { logger } from "../logger";
import { batchFetch } from "./base";
import { fetchGreenhouseJobs } from "./greenhouse";
import { fetchLeverJobs } from "./lever";
import { fetchAshbyJobs } from "./ashby";
import { fetchWorkableJobs } from "./workable";
import { fetchSmartRecruitersJobs } from "./smartrecruiters";
import { fetchBambooHRJobs } from "./bamboohr";
import { fetchWorkdayJobs } from "./workday";
import { fetchIcimsJobs } from "./icims";
import {
  runSerpApiQueryPack,
  DEFAULT_AGGREGATOR_QUERIES,
  DEFAULT_UNDERGROUND_QUERIES,
} from "./serpapi-jobs";
import type { ConnectorResult } from "../types";
import type { AppConfig, SourceDefinition } from "../config";
import {
  getActiveDiscoveredBoards,
  updateBoardPollState,
} from "../db/operations";

export { fetchGreenhouseJobs } from "./greenhouse";
export { fetchLeverJobs } from "./lever";
export { fetchAshbyJobs } from "./ashby";
export { fetchWorkableJobs } from "./workable";
export { fetchSmartRecruitersJobs } from "./smartrecruiters";
export { fetchBambooHRJobs } from "./bamboohr";
export { fetchWorkdayJobs } from "./workday";
export { fetchIcimsJobs } from "./icims";
export { runSerpApiQueryPack } from "./serpapi-jobs";

export interface RunConnectorOptions {
  includeAts?: boolean;
  includeAggregators?: boolean;
  includeUnderground?: boolean;
}

export async function runConnectors(
  config: AppConfig,
  options: RunConnectorOptions = {},
): Promise<ConnectorResult[]> {
  const {
    includeAts = true,
    includeAggregators = true,
    includeUnderground = true,
  } = options;
  const allResults: ConnectorResult[] = [];
  const includeDiscoveredBoards = process.env.SMOKE_NO_DISCOVERED !== "true";

  if (includeAts) {
    const directApiSources: Array<{
      name: string;
      source: SourceDefinition;
      companies: string[];
      fetchFn: (
        company: string,
        source: SourceDefinition,
      ) => Promise<ConnectorResult>;
    }> = [];

    if (config.sources.sources.greenhouse?.enabled) {
      directApiSources.push({
        name: "greenhouse",
        source: config.sources.sources.greenhouse,
        companies: config.companies.greenhouse,
        fetchFn: fetchGreenhouseJobs,
      });
    }

    if (config.sources.sources.lever?.enabled) {
      directApiSources.push({
        name: "lever",
        source: config.sources.sources.lever,
        companies: config.companies.lever,
        fetchFn: fetchLeverJobs,
      });
    }

    if (config.sources.sources.ashby?.enabled) {
      directApiSources.push({
        name: "ashby",
        source: config.sources.sources.ashby,
        companies: config.companies.ashby,
        fetchFn: fetchAshbyJobs,
      });
    }

    if (config.sources.sources.smartrecruiters?.enabled) {
      directApiSources.push({
        name: "smartrecruiters",
        source: config.sources.sources.smartrecruiters,
        companies: config.companies.smartrecruiters ?? [],
        fetchFn: fetchSmartRecruitersJobs,
      });
    }

    if (config.sources.sources.workday?.enabled) {
      directApiSources.push({
        name: "workday",
        source: config.sources.sources.workday,
        companies: config.companies.workday ?? [],
        fetchFn: fetchWorkdayJobs,
      });
    }

    for (const { name, source, companies, fetchFn } of directApiSources) {
      const discovered = includeDiscoveredBoards
        ? getActiveDiscoveredBoards(
            name as
              | "greenhouse"
              | "lever"
              | "ashby"
              | "smartrecruiters"
              | "workday",
          )
        : [];
      const discoveredSlugs = discovered
        .map((b) => b.board_slug ?? extractBoardSlug(name, b.board_url))
        .filter((slug): slug is string => !!slug);

      const combinedCompanies = [
        ...new Set([...companies, ...discoveredSlugs]),
      ];

      if (combinedCompanies.length === 0) {
        logger.warn(`${name}: no companies in seed list — skipping`);
        continue;
      }

      logger.info(
        `Starting ${name} ingestion for ${combinedCompanies.length} companies...`,
      );

      const rateLimiting = source.rateLimiting ?? {
        delayBetweenRequestsMs: 200,
        batchSize: 20,
        batchPauseMs: 2000,
        maxRetries: 3,
        backoffStartMs: 5000,
      };

      const results = await batchFetch<ConnectorResult>({
        items: combinedCompanies,
        fetchFn: (company) => fetchFn(company, source),
        rateLimiting,
        onProgress: (completed, total) => {
          if (completed % 10 === 0 || completed === total) {
            logger.info(`  ${name}: ${completed}/${total} companies processed`);
          }
        },
      });

      allResults.push(...results);

      const succeeded = results.filter((r) => r.success).length;
      const totalJobs = results.reduce((sum, r) => sum + r.jobs.length, 0);
      logger.info(
        `${name} complete: ${succeeded}/${results.length} companies succeeded, ${totalJobs} jobs found`,
      );

      const resultByCompany = new Map(results.map((r) => [r.company, r]));
      for (const board of discovered) {
        const slug =
          board.board_slug ?? extractBoardSlug(name, board.board_url);
        if (!slug) continue;
        const match = resultByCompany.get(slug);
        if (!match) continue;
        updateBoardPollState(board.id, match.success, match.jobs.length);
      }
    }

    const pageParserSources: Array<{
      name: string;
      source: SourceDefinition;
      companies: string[];
      fetchFn: (
        company: string,
        source: SourceDefinition,
      ) => Promise<ConnectorResult>;
    }> = [];

    if (config.sources.sources.workable?.enabled) {
      pageParserSources.push({
        name: "workable",
        source: config.sources.sources.workable,
        companies: config.companies.workable ?? [],
        fetchFn: fetchWorkableJobs,
      });
    }

    if (config.sources.sources.bamboohr?.enabled) {
      pageParserSources.push({
        name: "bamboohr",
        source: config.sources.sources.bamboohr,
        companies: config.companies.bamboohr ?? [],
        fetchFn: fetchBambooHRJobs,
      });
    }

    if (config.sources.sources.icims?.enabled) {
      pageParserSources.push({
        name: "icims",
        source: config.sources.sources.icims,
        companies: config.companies.icims ?? [],
        fetchFn: fetchIcimsJobs,
      });
    }

    for (const { name, source, companies, fetchFn } of pageParserSources) {
      const discovered = includeDiscoveredBoards
        ? getActiveDiscoveredBoards(name as "workable" | "bamboohr" | "icims")
        : [];
      const discoveredSlugs = discovered
        .map((b) => b.board_slug ?? extractBoardSlug(name, b.board_url))
        .filter((slug): slug is string => !!slug);

      const combinedCompanies = [
        ...new Set([...companies, ...discoveredSlugs]),
      ];

      if (combinedCompanies.length === 0) {
        logger.warn(`${name}: no companies in seed list — skipping`);
        continue;
      }

      logger.info(
        `Starting ${name} ingestion for ${combinedCompanies.length} companies...`,
      );

      const rateLimiting = source.rateLimiting ?? {
        delayBetweenRequestsMs: 500,
        batchSize: 10,
        batchPauseMs: 3000,
        maxRetries: 3,
        backoffStartMs: 5000,
      };

      const results = await batchFetch<ConnectorResult>({
        items: combinedCompanies,
        fetchFn: (company) => fetchFn(company, source),
        rateLimiting,
        onProgress: (completed, total) => {
          if (completed % 5 === 0 || completed === total) {
            logger.info(`  ${name}: ${completed}/${total} companies processed`);
          }
        },
      });

      allResults.push(...results);

      const succeeded = results.filter((r) => r.success).length;
      const totalJobs = results.reduce((sum, r) => sum + r.jobs.length, 0);
      logger.info(
        `${name} complete: ${succeeded}/${results.length} companies succeeded, ${totalJobs} jobs found`,
      );
      const resultByCompany = new Map(results.map((r) => [r.company, r]));
      for (const board of discovered) {
        const slug =
          board.board_slug ?? extractBoardSlug(name, board.board_url);
        if (!slug) continue;
        const match = resultByCompany.get(slug);
        if (!match) continue;
        updateBoardPollState(board.id, match.success, match.jobs.length);
      }
    }
  }

  if (includeAggregators) {
    const aggregatorSource = config.sources.sources["serpapi-aggregators"];
    if (aggregatorSource?.enabled) {
      const queries =
        aggregatorSource.queries?.filter((q) => q.trim().length > 0) ??
        DEFAULT_AGGREGATOR_QUERIES;
      const result = await runSerpApiQueryPack("serpapi-aggregators", queries);
      allResults.push(result);
    }
  }

  if (includeUnderground) {
    const undergroundSource = config.sources.sources["serpapi-underground"];
    if (undergroundSource?.enabled) {
      const queries =
        undergroundSource.queries?.filter((q) => q.trim().length > 0) ??
        DEFAULT_UNDERGROUND_QUERIES;
      const result = await runSerpApiQueryPack("serpapi-underground", queries);
      allResults.push(result);
    }
  }

  return allResults;
}

function extractBoardSlug(source: string, url: string): string | null {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);

    if (source === "greenhouse") {
      const idx = parts.findIndex((p) => p === "boards");
      return idx >= 0 && parts[idx + 1] ? parts[idx + 1] : null;
    }
    if (source === "lever") {
      return parts[0] ?? null;
    }
    if (source === "ashby") {
      return parts[0] ?? null;
    }
    if (source === "workable") {
      return parts[0] ?? null;
    }
    if (source === "smartrecruiters") {
      return parts[0] ?? null;
    }
    if (source === "bamboohr") {
      const hostParts = parsed.hostname.split(".");
      return hostParts.length > 0 ? hostParts[0] : null;
    }
    if (source === "workday") {
      const full = `${parsed.hostname}${parsed.pathname}`.replace(/\/+$/, "");
      return full || null;
    }
    if (source === "icims") {
      const full = `${parsed.hostname}${parsed.pathname}`.replace(/\/+$/, "");
      return full || null;
    }
    return null;
  } catch {
    return null;
  }
}
