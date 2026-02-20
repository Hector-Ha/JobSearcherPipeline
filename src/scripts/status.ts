/**
 * Print last successful run, last error, queue sizes, retry queue depth, CSE key usage.
 * See FinalStrategy.md line 711.
 */

import { logger } from "../logger";
import { db, getDatabaseStats } from "../db";
import { getConfig } from "../config";

const config = getConfig();

logger.info("═══════════════════════════════════════════════════");
logger.info("  System Status");
logger.info("═══════════════════════════════════════════════════");

const stats = getDatabaseStats();
logger.info(`📊 Total jobs: ${stats.jobs_canonical ?? 0}`);
logger.info(`📬 Pending alerts: ${stats.alerts_retry_queue ?? 0}`);
logger.info(
  `🔄 Connector retries pending: ${stats.connector_retry_queue ?? 0}`,
);
logger.info(`📝 Notifications sent: ${stats.notifications ?? 0}`);
logger.info(`📋 Applications tracked: ${stats.applications ?? 0}`);

try {
  const lastRun = db
    .query<
      {
        id: number;
        run_type: string;
        started_at: string;
        finished_at: string | null;
        status: string;
        jobs_found: number;
        jobs_new: number;
      },
      []
    >(
      "SELECT id, run_type, started_at, finished_at, status, jobs_found, jobs_new FROM run_log ORDER BY started_at DESC LIMIT 1",
    )
    .get();

  if (lastRun) {
    logger.info(`\n🕐 Last run:`);
    logger.info(`   Type: ${lastRun.run_type}`);
    logger.info(`   Started: ${lastRun.started_at}`);
    logger.info(`   Finished: ${lastRun.finished_at ?? "still running"}`);
    logger.info(`   Status: ${lastRun.status}`);
    logger.info(
      `   Jobs found: ${lastRun.jobs_found}, New: ${lastRun.jobs_new}`,
    );
  } else {
    logger.info("\n🕐 No runs recorded yet");
  }
} catch {
  logger.info("\n🕐 No runs recorded yet");
}

logger.info(`\n⚙️  Environment: ${config.env.nodeEnv}`);
logger.info(`🧪 Dry run: ${config.env.dryRun}`);
logger.info(`🔑 SerpApi keys: ${config.env.serpApiKeys.length}`);
logger.info(
  `🏢 Seed companies: ${config.companies.greenhouse.length + config.companies.lever.length + config.companies.ashby.length + config.companies.workable.length + config.companies.smartrecruiters.length + config.companies.bamboohr.length + config.companies.workday.length + config.companies.icims.length}`,
);

const enabledSources = Object.entries(config.sources.sources)
  .filter(([, s]) => s.enabled)
  .map(([name]) => name);
logger.info(
  `📡 Enabled sources: ${enabledSources.length > 0 ? enabledSources.join(", ") : "none"}`,
);

logger.info("═══════════════════════════════════════════════════");
