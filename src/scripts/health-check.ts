/**
 * Verify all connectors are responding, check SQLite integrity.
 * See FinalStrategy.md line 710.
 */

import { logger } from "../logger";
import { checkDatabaseIntegrity, getDatabaseStats } from "../db";

logger.info("═══════════════════════════════════════════════════");
logger.info("  Health Check");
logger.info("═══════════════════════════════════════════════════");

const integrity = checkDatabaseIntegrity();
if (integrity.ok) {
  logger.info("✅ Database integrity: OK");
} else {
  logger.error(`❌ Database integrity: FAILED — ${integrity.result}`);
}

const stats = getDatabaseStats();
logger.info("📊 Database stats:");
for (const [table, count] of Object.entries(stats)) {
  if (count === -1) {
    logger.error(`   ❌ ${table}: TABLE MISSING`);
  } else {
    logger.info(`   ${table}: ${count} rows`);
  }
}

// TODO: Check each enabled connector endpoint
logger.warn("⚠️  Connector health checks not implemented yet");

logger.info("═══════════════════════════════════════════════════");
