/**
 * Ingest last 24h of jobs on first deploy.
 * Marks jobs as backfill = true in database.
 * See FinalStrategy.md line 708.
 */

import { logger } from "../logger";

logger.info("Backfill triggered — ingesting last 24 hours of jobs");
// TODO: Run connectors with date filter, mark as backfill
logger.warn("Backfill not implemented yet — waiting for Phase 1 Day 4");
