import { existsSync, mkdirSync, appendFileSync } from "fs";
import { join } from "path";

const LOGS_DIR = join(import.meta.dir, "../logs");
const LOG_FILE = join(LOGS_DIR, "app.log");

// Ensure logs directory exists
if (!existsSync(LOGS_DIR)) {
  mkdirSync(LOGS_DIR, { recursive: true });
}

type LogLevel = "info" | "warn" | "error" | "debug";

const LOG_COLORS: Record<LogLevel, string> = {
  info: "\x1b[36m", // cyan
  warn: "\x1b[33m", // yellow
  error: "\x1b[31m", // red
  debug: "\x1b[90m", // gray
};

const RESET = "\x1b[0m";

function getTimestamp(): string {
  return new Date().toLocaleString("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function formatLogEntry(
  level: LogLevel,
  message: string,
  ...args: unknown[]
): string {
  const timestamp = getTimestamp();
  const extraArgs =
    args.length > 0
      ? " " +
        args
          .map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a)))
          .join(" ")
      : "";
  return `[${timestamp}] [${level.toUpperCase()}] ${message}${extraArgs}`;
}

function writeToFile(entry: string): void {
  try {
    appendFileSync(LOG_FILE, entry + "\n", "utf-8");
  } catch {
    // Silently fail file writes
  }
}

function log(level: LogLevel, message: string, ...args: unknown[]): void {
  const entry = formatLogEntry(level, message, ...args);
  const color = LOG_COLORS[level];

  // Console output with color
  if (level === "error") {
    console.error(`${color}${entry}${RESET}`);
  } else if (level === "warn") {
    console.warn(`${color}${entry}${RESET}`);
  } else {
    console.log(`${color}${entry}${RESET}`);
  }

  // File output without color
  writeToFile(entry);
}

export const logger = {
  info: (message: string, ...args: unknown[]) => log("info", message, ...args),
  warn: (message: string, ...args: unknown[]) => log("warn", message, ...args),
  error: (message: string, ...args: unknown[]) =>
    log("error", message, ...args),
  debug: (message: string, ...args: unknown[]) =>
    log("debug", message, ...args),
};
