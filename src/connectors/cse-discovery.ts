import { logger } from "../logger";
import { upsertDiscoveredBoard } from "../db/operations";
import type { EnvConfig } from "../config";
import { serpApiSearch, type SerpApiResult } from "./serpapi";

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
  "site:boards.greenhouse.io developer toronto",
  "site:jobs.lever.co frontend developer",
  "site:jobs.ashbyhq.com backend developer",
  "site:myworkdayjobs.com frontend developer toronto",
  "site:careers.icims.com backend developer toronto",
];

export interface DiscoveryResult {
  totalScanned: number;
  totalInserted: number;
  byPlatform: Record<string, number>;
}

export async function runBoardDiscovery(
  env: EnvConfig,
): Promise<DiscoveryResult> {
  if (env.serpApiKeys.length === 0) {
    logger.error("No SerpApi keys configured — board discovery cannot run");
    return { totalScanned: 0, totalInserted: 0, byPlatform: {} };
  }

  const result: DiscoveryResult = {
    totalScanned: 0,
    totalInserted: 0,
    byPlatform: {
      greenhouse: 0,
      lever: 0,
      ashby: 0,
      workable: 0,
      smartrecruiters: 0,
      bamboohr: 0,
      workday: 0,
      icims: 0,
    },
  };

  for (const query of DISCOVERY_QUERIES) {
    logger.info(`🔍 Searching: "${query}"...`);
    let response: SerpApiResult;

    try {
      response = await serpApiSearch({
        engine: "google",
        q: query,
        num: 10,
      });
    } catch (error) {
      logger.error(`Board discovery query failed: ${String(error)}`);
      continue;
    }

    const items = response.organic_results ?? [];
    result.totalScanned += items.length;

    for (const item of items) {
      const combined = `${item.link} ${item.title} ${item.snippet}`;

      for (const [platform, pattern] of Object.entries(ATS_PATTERNS)) {
        const match = combined.match(pattern);
        if (!match) continue;

        const boardSlug =
          platform === "workday" || platform === "icims"
            ? match[1]
            : match[1].toLowerCase();
        const boardUrl = normalizeBoardUrl(platform, boardSlug);
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
          discoveredVia: "serpapi-scheduled",
        });

        result.totalInserted++;
        result.byPlatform[platform]++;
      }
    }

    await new Promise((r) => setTimeout(r, 2000));
  }

  logger.info(
    `Board discovery: scanned ${result.totalScanned} results, inserted ${result.totalInserted} boards`,
  );

  return result;
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
