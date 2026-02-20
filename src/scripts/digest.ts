import { logger } from "../logger";
import { initializeDatabase } from "../db";
import { loadConfig } from "../config";
import { sendDigest, initAlerts } from "../alerts";
import { formatDigest } from "../alerts/digest";

logger.info("═══════════════════════════════════════════════════");
logger.info("  Manual Digest Send");
logger.info("═══════════════════════════════════════════════════");

const config = loadConfig();
initializeDatabase();

initAlerts({
  telegramBotToken: config.env.telegramBotToken,
  telegramChatId: config.env.telegramChatId,
  telegramLogBotToken: config.env.telegramLogBotToken,
  telegramLogChatId: config.env.telegramLogChatId,
  dryRun: config.env.dryRun,
});

// Determine digest type from CLI argument
const arg = process.argv[2] ?? "morning";
const digestType = arg === "evening" ? "evening" : "morning";
const forceAll = process.argv.includes("--force-all");

logger.info(`Generating ${digestType} digest...`);
if (forceAll) {
  logger.warn(
    "⚠️ Force-all mode enabled: this will include jobs already sent in prior digests.",
  );
}
const digestPayload = formatDigest(digestType, { forceAll });

logger.info(`Digest preview: ${digestPayload.jobs.length} jobs found`);
logger.info(`  🔴 Top Priority: ${digestPayload.bands.topPriority.length}`);
logger.info(`  🟡 Good Match: ${digestPayload.bands.goodMatch.length}`);
logger.info(`  🟢 Also Found: ${digestPayload.bands.worthALook.length}`);
logger.info(`  ❓ Needs Review: ${digestPayload.bands.maybeReview.length}`);

const messageType =
  digestType === "morning" ? "morning_digest" : "evening_digest";
await sendDigest(
  digestPayload.header,
  messageType as "morning_digest" | "evening_digest",
  digestPayload.bands,
);

logger.info("Digest sent successfully.");
process.exit(0);
