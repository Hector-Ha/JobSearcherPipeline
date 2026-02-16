/**
 * Archive jobs older than 30 days, purge raw data older than 90 days.
 * See FinalStrategy.md line 714.
 */

import { logger } from "../logger";
import { initializeDatabase } from "../db";
import { archiveOldJobs } from "../db/operations";

logger.info("Archive old jobs triggered");

initializeDatabase();

try {
  const { archived, purged } = archiveOldJobs();
  logger.info(`Archived ${archived} jobs older than 30 days`);
  logger.info(`Purged ${purged} raw data entries older than 90 days`);
  logger.info("✅ Archive and purge complete");
} catch (error) {
  logger.error("Failed to archive/purge:", error);
  process.exit(1);
}
