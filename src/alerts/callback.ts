import { logger } from "../logger";
import { markJobApplied, markJobDismissed, getJobById } from "../db/operations";

interface TelegramCallbackQuery {
  id: string;
  from: {
    id: number;
    first_name: string;
  };
  message?: {
    message_id: number;
    chat: { id: number };
  };
  data?: string;
}

interface TelegramUpdate {
  update_id: number;
  callback_query?: TelegramCallbackQuery;
}

export async function handleCallbackQuery(
  update: TelegramUpdate,
  botToken: string,
): Promise<{ success: boolean; action?: string }> {
  const callbackQuery = update.callback_query;
  if (!callbackQuery?.data) {
    return { success: false };
  }

  const data = callbackQuery.data;
  logger.info(
    `Telegram callback: ${data} from ${callbackQuery.from.first_name}`,
  );

  // Parse action and job ID
  const [action, idStr] = data.split("_");
  const jobId = parseInt(idStr, 10);

  if (isNaN(jobId)) {
    logger.error(`Invalid callback data: ${data}`);
    return { success: false };
  }

  // Verify job exists
  const job = getJobById(jobId);
  if (!job) {
    await answerCallback(callbackQuery.id, botToken, "⚠️ Job not found");
    return { success: false };
  }

  try {
    if (action === "applied") {
      markJobApplied(jobId);
      await answerCallback(
        callbackQuery.id,
        botToken,
        `✅ Marked as applied: ${job.title}`,
      );

      // Edit original message to show status
      if (callbackQuery.message) {
        await editMessage(
          botToken,
          callbackQuery.message.chat.id,
          callbackQuery.message.message_id,
          `✅ APPLIED — ${job.title} @ ${job.company}`,
        );
      }
    } else if (action === "skip") {
      markJobDismissed(jobId);
      await answerCallback(
        callbackQuery.id,
        botToken,
        `❌ Skipped: ${job.title}`,
      );

      if (callbackQuery.message) {
        await editMessage(
          botToken,
          callbackQuery.message.chat.id,
          callbackQuery.message.message_id,
          `❌ SKIPPED — ${job.title} @ ${job.company}`,
        );
      }
    } else {
      await answerCallback(callbackQuery.id, botToken, "Unknown action");
      return { success: false };
    }

    return { success: true, action };
  } catch (error) {
    logger.error(`Callback handling failed: ${error}`);
    await answerCallback(callbackQuery.id, botToken, "⚠️ Error processing");
    return { success: false };
  }
}

async function answerCallback(
  callbackQueryId: string,
  botToken: string,
  text: string,
): Promise<void> {
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        callback_query_id: callbackQueryId,
        text,
        show_alert: false,
      }),
    });
  } catch (error) {
    logger.error(`answerCallbackQuery failed: ${error}`);
  }
}

async function editMessage(
  botToken: string,
  chatId: number,
  messageId: number,
  newText: string,
): Promise<void> {
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/editMessageText`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        text: newText,
        parse_mode: "HTML",
      }),
    });
  } catch (error) {
    logger.error(`editMessageText failed: ${error}`);
  }
}
