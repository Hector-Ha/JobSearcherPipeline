/**
 * Connector orchestrator — runs all enabled ATS connectors and returns results.
 * See FinalStrategy.md lines 55-91 for source breakdown and rate limiting.
 */

import { logger } from "../logger";
import { batchFetch } from "./base";
import { fetchGreenhouseJobs } from "./greenhouse";
import { fetchLeverJobs } from "./lever";
import { fetchAshbyJobs } from "./ashby";
import type { ConnectorResult } from "../types";
import type { AppConfig, SourceDefinition } from "../config";
import {
  getActiveDiscoveredBoards,
  updateBoardPollState,
} from "../db/operations";

export { fetchGreenhouseJobs } from "./greenhouse";
export { fetchLeverJobs } from "./lever";
export { fetchAshbyJobs } from "./ashby";

// ─── Run All Enabled Connectors ─────────────────────────────────────────────

export async function runAllConnectors(
  config: AppConfig,
): Promise<ConnectorResult[]> {
  const allResults: ConnectorResult[] = [];

  // Run Phase 1 direct-api connectors
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

  // Process each source type
  for (const { name, source, companies, fetchFn } of directApiSources) {
    const discovered = getActiveDiscoveredBoards(
      name as "greenhouse" | "lever" | "ashby",
    );
    const discoveredSlugs = discovered
      .map((b) => b.board_slug ?? extractBoardSlug(name, b.board_url))
      .filter((slug): slug is string => !!slug);

    const combinedCompanies = [...new Set([...companies, ...discoveredSlugs])];

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

    // Update poll state for discovered boards using the matching slug result
    const resultByCompany = new Map(results.map((r) => [r.company, r]));
    for (const board of discovered) {
      const slug = board.board_slug ?? extractBoardSlug(name, board.board_url);
      if (!slug) continue;
      const match = resultByCompany.get(slug);
      if (!match) continue;
      updateBoardPollState(board.id, match.success, match.jobs.length);
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
    return null;
  } catch {
    return null;
  }
}
