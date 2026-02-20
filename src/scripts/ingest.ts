import { logger } from "../logger";
import { initializeDatabase } from "../db";
import { loadConfig } from "../config";
import { runPipeline } from "../pipeline";

logger.info("═══════════════════════════════════════════════════");
logger.info("  Manual Ingest — Full ATS Pipeline");
logger.info("═══════════════════════════════════════════════════");

const config = loadConfig();
initializeDatabase();

// Auto-import discovered boards
const { importBoards } = await import("./sync-boards");
importBoards();

const result = await runPipeline(config, {
  runType: "manual",
  connectorOptions: {
    includeAts: true,
    includeAggregators: true,
    includeUnderground: true,
  },
});

logger.info("═══════════════════════════════════════════════════");
logger.info("  Ingest Complete");
logger.info("═══════════════════════════════════════════════════");
logger.info(`  Run ID:       ${result.runId}`);
logger.info(`  Jobs found:   ${result.jobsFound}`);
logger.info(`  Jobs new:     ${result.jobsNew}`);
logger.info(`  Jobs dupe:    ${result.jobsDuplicate}`);
logger.info(`  Jobs rejected: ${result.jobsRejected}`);
logger.info(`  Jobs maybe:   ${result.jobsMaybe}`);
logger.info(`  Alerts sent:  ${result.instantAlertsSent}`);
logger.info(`  Errors:       ${result.errors.length}`);
logger.info(`  Duration:     ${(result.durationMs / 1000).toFixed(1)}s`);

if (result.errors.length > 0) {
  logger.warn("Errors encountered:");
  result.errors.forEach((e) => logger.warn(`  • ${e}`));
}

// Only exit 1 if the pipeline fully failed (no jobs found at all)
// Partial 404s from wrong slugs are expected and not a failure
process.exit(result.jobsFound === 0 && result.errors.length > 0 ? 1 : 0);
