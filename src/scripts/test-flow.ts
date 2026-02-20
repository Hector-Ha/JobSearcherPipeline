import { logger } from "../logger";
import { initializeDatabase } from "../db";
import { loadConfig } from "../config";
import { runPipeline } from "../pipeline";
import { formatDigest } from "../alerts/digest";
import { unlinkSync, existsSync } from "fs";
import { join } from "path";

async function main() {
  const args = process.argv.slice(2);
  const clean = args.includes("--clean");
  const send = args.includes("--send");

  logger.info("═══════════════════════════════════════════════════");
  logger.info("  🧪 TEST FLOW — Ingest + Digest Verification");
  logger.info("═══════════════════════════════════════════════════");

  // 1. Clean DB if requested
  if (clean) {
    const dbPath = join(process.cwd(), "data", "jobsearch.db");
    if (existsSync(dbPath)) {
      logger.info(`Deleting database at ${dbPath}...`);
      try {
        unlinkSync(dbPath);
        logger.info("Database deleted.");
      } catch (e) {
        logger.error(`Failed to delete database: ${e}`);
      }
    } else {
      logger.info("No database found to delete.");
    }
  }

  // 2. Initialize
  const config = loadConfig();
  initializeDatabase();

  // Auto-import discovered boards
  const { importBoards } = await import("./sync-boards");
  importBoards();

  // 3. Run Pipeline (Ingest)
  logger.info("\n▶️  Running Ingest Pipeline...");
  const result = await runPipeline(config, {
    runType: "manual",
    connectorOptions: {
      includeAts: true,
      includeAggregators: true,
      includeUnderground: true,
    },
  });

  if (result.jobsFound === 0 && result.errors.length > 0) {
    logger.error("Pipeline failed. Aborting digest generation.");
    process.exit(1);
  }

  // 4. Generate Digest
  logger.info("\n▶️  Generating Digest Preview...");
  // We use "morning" as default for testing to get the classic view
  const digestPayload = formatDigest("morning");

  logger.info("═══════════════════════════════════════════════════");
  logger.info(`  📊 DIGEST SUMMARY`);
  logger.info("═══════════════════════════════════════════════════");
  logger.info(`  Total Jobs in Digest: ${digestPayload.jobs.length}`);
  logger.info(
    `  🔴 Top Priority:      ${digestPayload.bands.topPriority.length}`,
  );
  logger.info(
    `  🟡 Good Match:        ${digestPayload.bands.goodMatch.length}`,
  );
  logger.info(
    `  🟢 Worth A Look:      ${digestPayload.bands.worthALook.length}`,
  );
  logger.info(
    `  ❓ Maybe Review:      ${digestPayload.bands.maybeReview.length}`,
  );
  logger.info("═══════════════════════════════════════════════════");

  if (digestPayload.jobs.length === 0) {
    logger.warn("⚠️  Digest is empty! This might be because:");
    logger.warn("   1. All jobs were rejected by filters.");
    logger.warn("   2. No new jobs were found in this run.");
    logger.warn("   3. Jobs are 'rejected' or 'archived' status.");
  } else {
    logger.info("Top 3 Jobs Preview:");
    digestPayload.jobs.slice(0, 3).forEach((job, i) => {
      logger.info(`  ${i + 1}. [${job.score}] ${job.title} @ ${job.company}`);
      if (job.fitVerdict) {
        logger.info(`     🧠 AI Analysis: ${job.fitVerdict} (${job.fitScore})`);
      }
    });
  }

  logger.info("\n✅ Test Flow Complete.");
  logger.info(
    "To see full digest output, check the logs or run with --send (if implemented).",
  );
}

main().catch((e) => {
  logger.error(`Test flow failed: ${e}`);
  process.exit(1);
});
