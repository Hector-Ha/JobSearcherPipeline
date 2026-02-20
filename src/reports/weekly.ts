import { getDatabaseStats } from "../db";
import { getSourceAnalytics, getWeeklySummary } from "../db/operations";

function fmtPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function formatWeeklyReport(): string {
  const stats = getDatabaseStats();
  const summary = getWeeklySummary();
  const sourceAnalytics = getSourceAnalytics(7).slice(0, 6);
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
    `🎯 Weekly Funnel:`,
    `  • Jobs seen: ${summary.totalJobs}`,
    `  • New jobs: ${summary.totalNew}`,
    `  • Applied: ${summary.totalApplied}`,
    `  • Dismissed: ${summary.totalDismissed}`,
    "",
    `🧭 Source Yield (7d):`,
  ];

  if (sourceAnalytics.length === 0) {
    lines.push("  • No source metrics available yet.");
  } else {
    for (const source of sourceAnalytics) {
      lines.push(
        `  • ${source.source}: new ${source.totalNew}, apply ${fmtPct(source.applyConversionRate)}, dup ${fmtPct(source.duplicateRate)}, parseFail ${fmtPct(source.parseFailureRate)}`,
      );
    }
  }

  lines.push(
    "",
    `Run <code>bun run status</code> for detailed breakdown.`,
  );

  return lines.join("\n");
}
