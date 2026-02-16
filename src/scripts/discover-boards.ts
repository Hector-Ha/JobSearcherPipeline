/**
 * Manually trigger board name discovery via Google CSE.
 * Usage: bun run discover-boards
 */

import { logger } from "../logger";
import { loadConfig } from "../config";
import { initializeDatabase } from "../db";
import { upsertDiscoveredBoard } from "../db/operations";

interface CseItem {
  link?: string;
  title?: string;
  snippet?: string;
}

interface CseResponse {
  items?: CseItem[];
}

const ATS_PATTERNS = {
  greenhouse: /https?:\/\/boards\.greenhouse\.io\/([a-zA-Z0-9-]+)/i,
  lever: /https?:\/\/jobs\.lever\.co\/([a-zA-Z0-9-]+)/i,
  ashby: /https?:\/\/jobs\.ashbyhq\.com\/([a-zA-Z0-9-]+)/i,
} as const;

const DISCOVERY_QUERIES = [
  "site:boards.greenhouse.io software engineer canada",
  "site:jobs.lever.co software engineer canada",
  "site:jobs.ashbyhq.com software engineer canada",
  "site:boards.greenhouse.io backend developer toronto",
  "site:jobs.lever.co frontend developer toronto",
  "site:jobs.ashbyhq.com full stack developer canada",
];

logger.info("═══════════════════════════════════════════════════");
logger.info("  Board Discovery (Google CSE)");
logger.info("═══════════════════════════════════════════════════");

const config = loadConfig();
initializeDatabase();

const engineId = config.env.googleCseEngines.A;
if (!engineId) {
  logger.error("GOOGLE_CSE_ENGINE_A is missing. Discovery cannot run.");
  process.exit(1);
}

if (config.env.googleCseApiKeys.length === 0) {
  logger.error("No GOOGLE_CSE_API_KEY_* values configured.");
  process.exit(1);
}

let keyIndex = 0;
let inserted = 0;
let scanned = 0;

for (const query of DISCOVERY_QUERIES) {
  let response: Response | null = null;
  let lastStatus = 0;

  for (let attempt = 0; attempt < config.env.googleCseApiKeys.length; attempt++) {
    const key = config.env.googleCseApiKeys[keyIndex % config.env.googleCseApiKeys.length];
    const url = new URL("https://www.googleapis.com/customsearch/v1");
    url.searchParams.set("key", key);
    url.searchParams.set("cx", engineId);
    url.searchParams.set("q", query);
    url.searchParams.set("num", "10");

    try {
      response = await fetch(url.toString(), {
        headers: { Accept: "application/json" },
      });
      lastStatus = response.status;
      if (response.ok) {
        break;
      }
      keyIndex++;
    } catch {
      keyIndex++;
    }
  }

  try {
    if (!response || !response.ok) {
      logger.warn(`CSE query failed (${lastStatus || "network"}) for: ${query}`);
      continue;
    }

    const payload = (await response.json()) as CseResponse;
    const items = payload.items ?? [];
    scanned += items.length;

    for (const item of items) {
      const link = item.link ?? "";
      const title = item.title ?? "";
      const snippet = item.snippet ?? "";
      const combined = `${link} ${title} ${snippet}`;

      for (const [platform, pattern] of Object.entries(ATS_PATTERNS)) {
        const match = combined.match(pattern);
        if (!match) continue;

        const boardSlug = match[1].toLowerCase();
        const boardUrl = normalizeBoardUrl(platform, boardSlug);
        const companyGuess = boardSlug.replace(/-/g, " ");
        upsertDiscoveredBoard({
          platform: platform as "greenhouse" | "lever" | "ashby",
          boardUrl,
          boardSlug,
          companyGuess,
          confidence: 0.75,
          discoveredVia: "cse",
        });
        inserted++;
      }
    }
  } catch (error) {
    logger.warn(`Discovery query failed for "${query}": ${String(error)}`);
  }
}

logger.info(`Scanned ${scanned} CSE results.`);
logger.info(`Upserted ${inserted} board records.`);
logger.info("✅ Board discovery complete");

function normalizeBoardUrl(platform: string, slug: string): string {
  if (platform === "greenhouse") {
    return `https://boards.greenhouse.io/${slug}`;
  }
  if (platform === "lever") {
    return `https://jobs.lever.co/${slug}`;
  }
  return `https://jobs.ashbyhq.com/${slug}`;
}
