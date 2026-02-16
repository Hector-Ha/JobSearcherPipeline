import { getDatabaseStats } from "../db";

export function formatWeeklyReport(): string {
  const stats = getDatabaseStats();
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(weekStart.getDate() - 7);

  const lines: string[] = [
    `📊 <b>Weekly Report — ${weekStart.toLocaleDateString("en-CA")} to ${now.toLocaleDateString("en-CA")}</b>`,
    "",
    `📦 Database Totals:`,
    `  • Canonical jobs: ${stats.jobs_canonical ?? 0}`,
    `  • Raw jobs: ${stats.jobs_raw ?? 0}`,
    `  • Total runs: ${stats.run_log ?? 0}`,
    `  • Notifications sent: ${stats.notifications ?? 0}`,
    `  • Retry queue: ${stats.alerts_retry_queue ?? 0}`,
    "",
    `Run <code>bun run status</code> for detailed breakdown.`,
  ];

  return lines.join("\n");
}
