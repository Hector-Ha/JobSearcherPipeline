/**
 * Re-process jobs from raw data without hitting APIs.
 * See FinalStrategy.md line 716.
 */

import { logger } from "../logger";

// Parse CLI args
const args = process.argv.slice(2);
const dateIndex = args.indexOf("--date");
const sourceIndex = args.indexOf("--source");

const date = dateIndex !== -1 ? args[dateIndex + 1] : null;
const source = sourceIndex !== -1 ? args[sourceIndex + 1] : null;

if (!date || !source) {
  logger.error("Usage: bun run replay -- --date YYYY-MM-DD --source <source>");
  logger.error(
    "Example: bun run replay -- --date 2026-02-14 --source greenhouse",
  );
  process.exit(1);
}

logger.info(`Replay triggered — date: ${date}, source: ${source}`);
// TODO: Read from jobs_raw, re-process, show results
logger.warn("Replay not implemented yet");
