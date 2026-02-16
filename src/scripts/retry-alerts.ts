import { logger } from "../logger";
import { initializeDatabase } from "../db";
import { loadConfig } from "../config";
import { initAlerts, sendMessage } from "../alerts";
import {
  getPendingRetryAlerts,
  removeRetryAlert,
  incrementRetryCount,
} from "../db/operations";

logger.info("Retry alerts triggered — flushing Telegram retry queue");

const config = loadConfig();
initializeDatabase();
initAlerts({
  telegramBotToken: config.env.telegramBotToken,
  telegramChatId: config.env.telegramChatId,
  telegramLogBotToken: config.env.telegramLogBotToken,
  telegramLogChatId: config.env.telegramLogChatId,
  dryRun: config.env.dryRun,
});

const pending = getPendingRetryAlerts();
logger.info(`Found ${pending.length} retry alerts ready to resend`);

let successCount = 0;
let failedCount = 0;

for (const item of pending) {
  const result = await sendMessage(
    item.bot_type === "log" ? "log" : "job",
    item.message_text,
  );

  if (result.success) {
    removeRetryAlert(item.id);
    successCount++;
  } else {
    incrementRetryCount(item.id, result.error ?? "Unknown resend error");
    failedCount++;
  }
}

logger.info(
  `Retry flush complete — success: ${successCount}, failed: ${failedCount}`,
);
