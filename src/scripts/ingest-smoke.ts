import { logger } from "../logger";
import { initializeDatabase, db } from "../db";
import { loadConfig, type AppConfig } from "../config";
import { runPipeline } from "../pipeline";

function parseLimitArg(): number {
  const arg = process.argv.find((a) => a.startsWith("--per-source="));
  if (!arg) return 1;
  const parsed = parseInt(arg.split("=")[1] ?? "1", 10);
  if (Number.isNaN(parsed) || parsed < 1) return 1;
  return Math.min(parsed, 5);
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function getFitAnalysisCount(): number {
  const row = db
    .query<
      { count: number },
      []
    >("SELECT COUNT(*) as count FROM job_fit_analysis")
    .get();
  return row?.count ?? 0;
}

function buildSmokeConfig(
  base: AppConfig,
  perSource: number,
  withAi: boolean,
): AppConfig {
  return {
    ...base,
    env: {
      ...base.env,
      // Default smoke mode is fast; --with-ai enables real AI checks.
      dryRun: withAi ? false : true,
      aiAnalysisMinScore: withAi ? base.env.aiAnalysisMinScore : 101,
    },
    companies: {
      ...base.companies,
      greenhouse: base.companies.greenhouse.slice(0, perSource),
      lever: base.companies.lever.slice(0, perSource),
      ashby: base.companies.ashby.slice(0, perSource),
      workable: base.companies.workable.slice(0, perSource),
      smartrecruiters: base.companies.smartrecruiters.slice(0, perSource),
      bamboohr: base.companies.bamboohr.slice(0, perSource),
      workday: base.companies.workday.slice(0, perSource),
      icims: base.companies.icims.slice(0, perSource),
    },
  };
}

logger.info("═══════════════════════════════════════════════════");
logger.info("  Smoke Ingest — Small Scope Pipeline Check");
logger.info("═══════════════════════════════════════════════════");

const perSource = parseLimitArg();
const withAi = hasFlag("--with-ai");
const includeDiscoveredBoards = hasFlag("--with-discovered");
const baseConfig = loadConfig();
const config = buildSmokeConfig(baseConfig, perSource, withAi);

initializeDatabase();
process.env.SMOKE_NO_DISCOVERED = includeDiscoveredBoards ? "false" : "true";
const fitCountBefore = getFitAnalysisCount();

logger.info(
  `Smoke config: per-source limit=${perSource}, dryRun=${config.env.dryRun}, aiAnalysisMinScore=${config.env.aiAnalysisMinScore}, discoveredBoards=${includeDiscoveredBoards}`,
);

const result = await runPipeline(config, { runType: "manual-smoke" });
const fitCountAfter = getFitAnalysisCount();
const fitDelta = fitCountAfter - fitCountBefore;

logger.info("═══════════════════════════════════════════════════");
logger.info("  Smoke Ingest Complete");
logger.info("═══════════════════════════════════════════════════");
logger.info(`  Run ID:       ${result.runId}`);
logger.info(`  Jobs found:   ${result.jobsFound}`);
logger.info(`  Jobs new:     ${result.jobsNew}`);
logger.info(`  Jobs dupe:    ${result.jobsDuplicate}`);
logger.info(`  Jobs rejected: ${result.jobsRejected}`);
logger.info(`  Jobs maybe:   ${result.jobsMaybe}`);
logger.info(`  AI analyzed:  ${result.jobsAnalyzed}`);
logger.info(`  Fit rows new: ${fitDelta}`);
logger.info(`  Errors:       ${result.errors.length}`);
logger.info(`  Duration:     ${(result.durationMs / 1000).toFixed(1)}s`);

if (result.errors.length > 0) {
  logger.warn("Smoke run errors:");
  for (const error of result.errors) {
    logger.warn(`  • ${error}`);
  }
}

process.exit(result.errors.length > 0 ? 1 : 0);
