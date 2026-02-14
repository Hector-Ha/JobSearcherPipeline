/**
 * Archive jobs older than 30 days, purge raw data older than 90 days.
 * See FinalStrategy.md line 714.
 */

import { logger } from "../logger";
import { db } from "../db";

logger.info("Archive old jobs triggered");

try {
  // Archive jobs older than 30 days
  const archiveResult = db.run(`
    UPDATE jobs_canonical
    SET status = 'archived', archived_at = datetime('now')
    WHERE status = 'active'
    AND first_seen_at < datetime('now', '-30 days')
  `);
  logger.info(`Archived ${archiveResult.changes} jobs older than 30 days`);

  // Purge raw data older than 90 days
  const purgeResult = db.run(`
    DELETE FROM jobs_raw
    WHERE fetched_at < datetime('now', '-90 days')
  `);
  logger.info(
    `Purged ${purgeResult.changes} raw data entries older than 90 days`,
  );

  logger.info("✅ Archive and purge complete");
} catch (error) {
  logger.error("Failed to archive/purge:", error);
  process.exit(1);
}
