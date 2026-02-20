import { logger } from "../logger";
import { initializeDatabase } from "../db";
import { loadConfig } from "../config";
import { runPipeline } from "../pipeline";

logger.info("═══════════════════════════════════════════════════");
logger.info("  Backfill — First Deploy Catch-up");
logger.info("═══════════════════════════════════════════════════");

const config = loadConfig();
initializeDatabase();

logger.info("Running backfill — jobs will NOT trigger instant alerts");

const result = await runPipeline(config, {
  runType: "backfill",
  isBackfill: true,
  connectorOptions: {
    includeAts: true,
    includeAggregators: true,
    includeUnderground: true,
  },
});

logger.info("═══════════════════════════════════════════════════");
logger.info("  Backfill Complete");
logger.info("═══════════════════════════════════════════════════");
logger.info(`  Jobs found:   ${result.jobsFound}`);
logger.info(`  Jobs new:     ${result.jobsNew}`);
logger.info(`  Jobs dupe:    ${result.jobsDuplicate}`);
logger.info(`  Duration:     ${(result.durationMs / 1000).toFixed(1)}s`);

process.exit(0);
