/**
 * Telegram Bot integration — dual-bot system.
 * Bot 1 (Job Alerts): instant pings, digests, weekly reports
 * Bot 2 (System Logs): errors, health alerts, monitoring
 * See FinalStrategy.md lines 255-364.
 */

import { logger } from "../logger";
import {
  logNotification,
  queueAlertRetry,
  getAlternateUrls,
} from "../db/operations";
import type { BotType, MessageType } from "../types";

interface TelegramInlineButton {
  text: string;
  callback_data: string;
}

interface TelegramSendResult {
  ok: boolean;
  result?: {
    message_id: number;
  };
  description?: string;
}

let _botTokens: Record<BotType, string> = { job: "", log: "" };
let _chatIds: Record<BotType, string> = { job: "", log: "" };
let _dryRun = false;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeHref(url: string): string {
  return escapeHtml(url.trim());
}

export function initAlerts(config: {
  telegramBotToken: string;
  telegramChatId: string;
  telegramLogBotToken: string;
  telegramLogChatId: string;
  dryRun: boolean;
}): void {
  _botTokens = {
    job: config.telegramBotToken,
    log: config.telegramLogBotToken,
  };
  _chatIds = {
    job: config.telegramChatId,
    log: config.telegramLogChatId,
  };
  _dryRun = config.dryRun;
}

export async function sendMessage(
  botType: BotType,
  text: string,
  inlineKeyboard?: TelegramInlineButton[][],
): Promise<{ success: boolean; messageId?: number; error?: string }> {
  const token = _botTokens[botType];
  const chatId = _chatIds[botType];

  if (!token || !chatId) {
    const msg = `Telegram ${botType} bot not configured — skipping`;
    logger.warn(msg);
    return { success: false, error: msg };
  }

  if (_dryRun) {
    logger.info(`[DRY RUN] Would send to ${botType} bot:`);
    logger.info(text.substring(0, 200) + (text.length > 200 ? "..." : ""));
    return { success: true, messageId: 0 };
  }

  try {
    const body: Record<string, unknown> = {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    };

    if (inlineKeyboard) {
      body.reply_markup = { inline_keyboard: inlineKeyboard };
    }

    const response = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );

    const result = (await response.json()) as TelegramSendResult;

    if (!result.ok) {
      throw new Error(result.description ?? "Telegram API error");
    }

    return {
      success: true,
      messageId: result.result?.message_id,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error(`Telegram ${botType} send failed: ${errorMsg}`);
    return { success: false, error: errorMsg };
  }
}

// Job Alert (Instant Ping for Score ≥ 80)

import type { FitAnalysis } from "../ai/types";

export async function sendJobAlert(
  job: {
    id: number;
    title: string;
    company: string;
    city: string | null;
    workMode: string;
    score: number;
    scoreBand: string;
    url: string;
    source: string;
    postedAt: string | null;
    firstSeenAt: string;
  },
  fitAnalysis?: FitAnalysis | null,
): Promise<void> {
  const timeAgo = formatTimeAgo(job.postedAt ?? job.firstSeenAt);
  const locationStr = escapeHtml(job.city ?? "Unknown");
  const modeStr =
    job.workMode !== "unknown" ? ` (${escapeHtml(job.workMode)})` : "";
  const title = escapeHtml(job.title);
  const company = escapeHtml(job.company);
  const sourceLabel = escapeHtml(job.source);
  const primaryUrl = safeHref(job.url);

  // Get alternate URLs from other sources
  const alternates = getAlternateUrls(job.id);
  const altLinks =
    alternates.length >= 2
      ? ` | 🔗 Also on: ${alternates
          .map(
            (a) =>
              `<a href="${safeHref(a.url)}">${escapeHtml(capitalize(a.source))}</a>`,
          )
          .join(" | ")}`
      : alternates.length === 1
        ? ` | 🔗 Also on: <a href="${safeHref(alternates[0].url)}">${escapeHtml(capitalize(alternates[0].source))}</a>`
        : "";

  const lines = [
    `🔴 <b>TOP PRIORITY — Score: ${job.score}</b>`,
    `${title} @ ${company}`,
    `📍 ${locationStr}${modeStr} | 🕐 ${timeAgo}`,
    `🔗 Apply: <a href="${primaryUrl}">${sourceLabel}</a>${altLinks}`,
  ];

  // Add AI fit analysis if available
  if (fitAnalysis) {
    const verdictEmoji =
      {
        strong: "🟢",
        moderate: "🟡",
        weak: "🟠",
        stretch: "🔴",
      }[fitAnalysis.verdict] ?? "⚪";

    lines.push("");
    lines.push(
      `🧠 <b>AI Fit: ${fitAnalysis.fitScore}/100 — ${verdictEmoji} ${escapeHtml(capitalize(fitAnalysis.verdict))}</b>`,
    );
    lines.push(`📊 ${escapeHtml(fitAnalysis.summary)}`);

    if (fitAnalysis.keySkillsMatched.length > 0) {
      lines.push(
        `✅ Match: ${escapeHtml(fitAnalysis.keySkillsMatched.slice(0, 6).join(", "))}`,
      );
    }
    if (fitAnalysis.keySkillsMissing.length > 0) {
      lines.push(
        `❌ Gaps: ${escapeHtml(fitAnalysis.keySkillsMissing.slice(0, 5).join(", "))}`,
      );
    }
    lines.push(`💡 ${escapeHtml(fitAnalysis.recommendation)}`);

    if (fitAnalysis.resumeTailoringTips.length > 0) {
      lines.push("");
      lines.push("📝 <b>Resume Tips:</b>");
      for (const tip of fitAnalysis.resumeTailoringTips.slice(0, 3)) {
        lines.push(`• ${escapeHtml(tip)}`);
      }
    }
  }

  const message = lines.join("\n");

  const keyboard: TelegramInlineButton[][] = [
    [
      { text: "✅ Applied", callback_data: `applied_${job.id}` },
      { text: "❌ Skip", callback_data: `skip_${job.id}` },
    ],
  ];

  const result = await sendMessage("job", message, keyboard);

  logNotification(
    "job",
    "instant_alert",
    job.id,
    message,
    result.messageId?.toString() ?? null,
    result.success,
    result.error ?? null,
  );

  if (!result.success) {
    queueAlertRetry("job", "instant_alert", job.id, message, result.error!);
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// System Alert

export async function sendSystemAlert(
  message: string,
  messageType: MessageType = "system_alert",
): Promise<void> {
  const result = await sendMessage("log", message);

  logNotification(
    "log",
    messageType,
    null,
    message,
    result.messageId?.toString() ?? null,
    result.success,
    result.error ?? null,
  );

  if (!result.success) {
    queueAlertRetry("log", messageType, null, message, result.error!);
  }
}

// Digest — card-based: each job gets its own message with action buttons

import type { DigestJob } from "./digest";
import { formatJobCard } from "./digest";

export async function sendDigest(
  header: string,
  messageType: "morning_digest" | "evening_digest",
  bands: {
    topPriority: DigestJob[];
    goodMatch: DigestJob[];
    worthALook: DigestJob[];
    maybeReview: DigestJob[];
  },
): Promise<void> {
  // Send the header summary
  const headerResult = await sendMessage("job", header);
  logNotification(
    "job",
    messageType,
    null,
    header,
    headerResult.messageId?.toString() ?? null,
    headerResult.success,
    headerResult.error ?? null,
  );

  let counter = 0;
  let sent = 0;
  let failed = 0;

  // Helper to send a band of jobs
  async function sendBand(bandLabel: string, jobs: DigestJob[]) {
    if (jobs.length === 0) return;

    // Send band separator
    await sendMessage("job", bandLabel);
    await sleep(50);

    for (const job of jobs) {
      counter++;
      const cardText = formatJobCard(job, counter);
      const keyboard: TelegramInlineButton[][] = [
        [
          { text: "✅ Applied", callback_data: `applied_${job.id}` },
          { text: "❌ Skip", callback_data: `skip_${job.id}` },
        ],
      ];

      const result = await sendMessage("job", cardText, keyboard);
      if (result.success) {
        sent++;
        logNotification(
          "job",
          messageType,
          job.id,
          cardText,
          result.messageId?.toString() ?? null,
          true,
          null,
        );
      } else {
        failed++;
        logNotification(
          "job",
          messageType,
          job.id,
          cardText,
          result.messageId?.toString() ?? null,
          false,
          result.error ?? null,
        );
        queueAlertRetry("job", messageType, job.id, cardText, result.error!);
      }

      // Rate limit: Telegram allows ~30 msgs/sec, be conservative
      await sleep(50);
    }
  }

  // Send each band with its jobs (cards with buttons)
  await sendBand("🔴 <b>TOP PRIORITY (80+)</b>", bands.topPriority);
  await sendBand("🟡 <b>GOOD MATCH (50-79)</b>", bands.goodMatch);
  await sendBand("🟢 <b>ALSO FOUND (&lt;50)</b>", bands.worthALook);

  // Compact text list, no buttons
  if (bands.maybeReview.length > 0) {
    const reviewLines = [
      "❓ <b>NEEDS REVIEW (ambiguous titles)</b>",
      "",
      ...bands.maybeReview.map(
        (j) =>
          `• [${j.score}] ${j.title} @ ${j.company} → <a href="${j.url}">Check</a>`,
      ),
    ];
    const reviewText = reviewLines.join("\n");

    // Chunk if over Telegram's limit
    const chunks = splitMessage(reviewText, 4000);
    for (const chunk of chunks) {
      await sendMessage("job", chunk);
      await sleep(50);
    }
  }

  logger.info(
    `Digest sent: ${sent} cards delivered, ${failed} failed, ${counter} total`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatTimeAgo(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffHours / 24);

  if (diffHours < 1) return "just now";
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return "1d ago";
  return `${diffDays}d ago`;
}

function splitMessage(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  const lines = text.split("\n");
  let current = "";

  for (const line of lines) {
    // Hard-split any single line that exceeds maxLength
    // (prevents Telegram API rejection for messages > 4096 chars)
    if (line.length > maxLength) {
      if (current) {
        chunks.push(current.trim());
        current = "";
      }
      let remaining = line;
      while (remaining.length > maxLength) {
        chunks.push(remaining.substring(0, maxLength));
        remaining = remaining.substring(maxLength);
      }
      if (remaining) current = remaining;
      continue;
    }

    if (current.length + line.length + 1 > maxLength) {
      if (current) chunks.push(current.trim());
      current = line;
    } else {
      current += (current ? "\n" : "") + line;
    }
  }
  if (current) chunks.push(current.trim());

  return chunks;
}
