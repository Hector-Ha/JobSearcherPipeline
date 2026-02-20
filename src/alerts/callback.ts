import { logger } from "../logger";
import { markJobApplied, markJobDismissed, getJobById } from "../db/operations";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

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

interface TelegramApiResponse<T> {
  ok: boolean;
  result: T;
  description?: string;
}

interface TelegramWebhookInfo {
  url: string;
}

let pollingStarted = false;

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
          `✅ APPLIED — ${escapeHtml(job.title)} @ ${escapeHtml(job.company)}`,
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
          `❌ SKIPPED — ${escapeHtml(job.title)} @ ${escapeHtml(job.company)}`,
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

export function startCallbackPolling(
  botToken: string,
  options: { force?: boolean; timeoutSeconds?: number } = {},
): void {
  if (pollingStarted) {
    return;
  }
  if (!botToken) {
    logger.warn("Telegram callback polling skipped: bot token missing");
    return;
  }
  pollingStarted = true;

  const timeoutSeconds = options.timeoutSeconds ?? 25;

  void (async () => {
    try {
      if (!options.force) {
        const webhookInfo = await getWebhookInfo(botToken);
        if (webhookInfo.url) {
          logger.info(
            `Telegram callback polling disabled (webhook active: ${webhookInfo.url})`,
          );
          return;
        }
      }

      logger.info(
        "Telegram callback polling enabled (no webhook detected).",
      );
      await pollCallbackLoop(botToken, timeoutSeconds);
    } catch (error) {
      logger.error(`Telegram callback polling failed to start: ${error}`);
    }
  })();
}

async function getWebhookInfo(botToken: string): Promise<TelegramWebhookInfo> {
  const response = await fetch(
    `https://api.telegram.org/bot${botToken}/getWebhookInfo`,
  );
  const payload = (await response.json()) as TelegramApiResponse<TelegramWebhookInfo>;
  if (!payload.ok) {
    throw new Error(payload.description ?? "getWebhookInfo failed");
  }
  return payload.result;
}

async function pollCallbackLoop(
  botToken: string,
  timeoutSeconds: number,
): Promise<void> {
  let offset: number | undefined;

  while (true) {
    try {
      const body: {
        timeout: number;
        allowed_updates: string[];
        offset?: number;
      } = {
        timeout: timeoutSeconds,
        allowed_updates: ["callback_query"],
      };
      if (offset !== undefined) {
        body.offset = offset;
      }

      const response = await fetch(
        `https://api.telegram.org/bot${botToken}/getUpdates`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const payload = (await response.json()) as TelegramApiResponse<TelegramUpdate[]>;

      if (!payload.ok) {
        const desc = payload.description ?? "getUpdates failed";
        logger.warn(`Telegram callback polling warning: ${desc}`);
        await sleep(3000);
        continue;
      }

      for (const update of payload.result) {
        offset = update.update_id + 1;
        if (update.callback_query) {
          await handleCallbackQuery(update, botToken);
        }
      }
    } catch (error) {
      logger.warn(`Telegram callback polling error: ${error}`);
      await sleep(3000);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
