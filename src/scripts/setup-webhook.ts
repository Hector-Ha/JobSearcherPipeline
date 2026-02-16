import { logger } from "../logger";
import { loadConfig } from "../config";

logger.info("═══════════════════════════════════════════════════");
logger.info("  Telegram Webhook Setup");
logger.info("═══════════════════════════════════════════════════");

const config = loadConfig();

const webhookUrl = process.argv[2];

if (!webhookUrl) {
  logger.error("Usage: bun run src/scripts/setup-webhook.ts <YOUR_PUBLIC_URL>");
  logger.error("Example: bun run src/scripts/setup-webhook.ts https://yourdomain.com/api/telegram/callback");
  process.exit(1);
}

if (!config.env.telegramBotToken) {
  logger.error("TELEGRAM_BOT_TOKEN not set in environment");
  process.exit(1);
}

const fullUrl = webhookUrl.endsWith("/api/telegram/callback")
  ? webhookUrl
  : `${webhookUrl.replace(/\/$/, "")}/api/telegram/callback`;

logger.info(`Setting webhook to: ${fullUrl}`);

try {
  const response = await fetch(
    `https://api.telegram.org/bot${config.env.telegramBotToken}/setWebhook`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: fullUrl,
        allowed_updates: ["callback_query"],
      }),
    },
  );

  const result = (await response.json()) as { ok: boolean; description?: string };

  if (result.ok) {
    logger.info("✅ Webhook registered successfully");
  } else {
    logger.error(`❌ Webhook registration failed: ${result.description}`);
    process.exit(1);
  }
} catch (error) {
  logger.error(`Webhook setup failed: ${error}`);
  process.exit(1);
}
