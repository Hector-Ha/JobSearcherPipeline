import { logger } from "../logger";
import { loadConfig } from "../config";
import { initializeDatabase } from "../db";
import { upsertDiscoveredBoard } from "../db/operations";
import { serpApiSearch, type SerpApiResult } from "../connectors/serpapi";

const ATS_PATTERNS = {
  greenhouse: /https?:\/\/boards\.greenhouse\.io\/([a-zA-Z0-9-]+)/i,
  lever: /https?:\/\/jobs\.lever\.co\/([a-zA-Z0-9-]+)/i,
  ashby: /https?:\/\/jobs\.ashbyhq\.com\/([a-zA-Z0-9-]+)/i,
  workable: /https?:\/\/(?:careers|apply)\.workable\.com\/([a-zA-Z0-9-]+)/i,
  smartrecruiters: /https?:\/\/jobs\.smartrecruiters\.com\/([a-zA-Z0-9-]+)/i,
  bamboohr: /https?:\/\/jobs\.bamboohr\.com\/([a-zA-Z0-9-]+)/i,
  workday: /https?:\/\/([a-zA-Z0-9.-]+\.myworkdayjobs\.com\/[^\s"'<>]+)/i,
  icims: /https?:\/\/(careers\.icims\.com\/[^\s"'<>]+)/i,
} as const;

const DISCOVERY_QUERIES = [
  "site:boards.greenhouse.io software engineer canada",
  "site:jobs.lever.co software engineer canada",
  "site:jobs.ashbyhq.com software engineer canada",
  "site:careers.workable.com software engineer canada",
  "site:apply.workable.com software engineer canada",
  "site:jobs.smartrecruiters.com software engineer canada",
  "site:jobs.bamboohr.com software engineer canada",
  "site:myworkdayjobs.com software engineer canada",
  "site:careers.icims.com software engineer canada",
  "site:boards.greenhouse.io backend developer toronto",
  "site:jobs.lever.co frontend developer toronto",
  "site:jobs.ashbyhq.com full stack developer canada",
  "site:myworkdayjobs.com frontend developer toronto",
  "site:careers.icims.com full stack developer canada",
];

async function run() {
  logger.info("═══════════════════════════════════════════════════");
  logger.info("  Board Discovery (SerpApi / Google)");
  logger.info("═══════════════════════════════════════════════════");

  const config = loadConfig();
  initializeDatabase();

  if (config.env.serpApiKeys.length === 0) {
    logger.error(
      "❌ No SERPAPI_KEY_* values configured. Discovery cannot run.",
    );
    logger.info("👉 Add SERPAPI_KEY_1=... to your .env file.");
    process.exit(1);
  }

  let inserted = 0;
  let scanned = 0;

  for (const query of DISCOVERY_QUERIES) {
    logger.info(`🔍 Searching: "${query}"...`);

    try {
      const result = await serpApiSearch({
        engine: "google",
        q: query,
        num: 10, // Max per page usually
      });

      const items = result.organic_results || [];
      scanned += items.length;

      for (const item of items) {
        const link = item.link ?? "";
        const title = item.title ?? "";
        const snippet = item.snippet ?? "";
        const combined = `${link} ${title} ${snippet}`;

        for (const [platform, pattern] of Object.entries(ATS_PATTERNS)) {
          const match = combined.match(pattern);
          if (!match) continue;

          const boardSlug =
            platform === "workday" || platform === "icims"
              ? match[1]
              : match[1].toLowerCase();

          // Skip common false positives or generic pages if necessary
          if (boardSlug === "jobs" || boardSlug === "careers") continue;

          const boardUrl = normalizeBoardUrl(platform, boardSlug);
          // Simple heuristic: slug often is the company name
          const companyGuess = boardSlug.replace(/-/g, " ");

          upsertDiscoveredBoard({
            platform: platform as
              | "greenhouse"
              | "lever"
              | "ashby"
              | "workable"
              | "smartrecruiters"
              | "bamboohr"
              | "workday"
              | "icims",
            boardUrl,
            boardSlug,
            companyGuess,
            confidence: 0.75,
            discoveredVia: "serpapi",
          });
          inserted++;
        }
      }
    } catch (error) {
      logger.error(`❌ Query failed for "${query}": ${String(error)}`);
    }

    // Polite delay between queries (though serpapi handles rate limits, we don't want to burn keys too fast)
    await new Promise((r) => setTimeout(r, 2000));
  }

  logger.info("═══════════════════════════════════════════════════");
  logger.info(`✅ Discovery Complete`);
  logger.info(`   - Results Scanned: ${scanned}`);
  logger.info(`   - Boards Upserted: ${inserted}`);
  logger.info("═══════════════════════════════════════════════════");

  // Auto-export to JSON for persistence
  const { exportBoards } = await import("./sync-boards");
  exportBoards();
}

function normalizeBoardUrl(platform: string, slug: string): string {
  if (platform === "greenhouse") {
    return `https://boards.greenhouse.io/${slug}`;
  }
  if (platform === "lever") {
    return `https://jobs.lever.co/${slug}`;
  }
  if (platform === "ashby") {
    return `https://jobs.ashbyhq.com/${slug}`;
  }
  if (platform === "workable") {
    return `https://apply.workable.com/${slug}`;
  }
  if (platform === "smartrecruiters") {
    return `https://jobs.smartrecruiters.com/${slug}`;
  }
  if (platform === "bamboohr") {
    return `https://jobs.bamboohr.com/${slug}`;
  }
  return `https://${slug}`;
}

run().catch((e) => logger.error(`Fatal error: ${e}`));
