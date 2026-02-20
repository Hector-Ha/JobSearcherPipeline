import { logger } from "../logger";
import { getUndigestedJobs, getFitAnalysis, getAlternateUrls } from "../db/operations";

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

export interface DigestJob {
  id: number;
  title: string;
  company: string;
  url: string;
  city: string | null;
  workMode: string;
  score: number;
  scoreBand: string;
  postedAt: string | null;
  firstSeenAt: string;
  titleBucket: string;
  // AI Fit (optional — present if job was analyzed)
  fitScore?: number;
  fitVerdict?: string;
  fitSummary?: string;
}

export interface DigestPayload {
  header: string;
  jobs: DigestJob[];
  bands: {
    topPriority: DigestJob[];
    goodMatch: DigestJob[];
    worthALook: DigestJob[];
    maybeReview: DigestJob[];
  };
}

export function formatDigest(
  digestType: "morning" | "evening",
  options: { forceAll?: boolean } = {},
): DigestPayload {
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-CA", {
    timeZone: "America/Toronto",
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  // Get jobs since last digest
  let sinceDate: string;
  if (digestType === "morning") {
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(18, 0, 0, 0);
    sinceDate = yesterday.toISOString();
  } else {
    const today = new Date(now);
    today.setHours(8, 30, 0, 0);
    sinceDate = today.toISOString();
  }

  const rawJobs = getUndigestedJobs(sinceDate, options.forceAll === true);

  const jobs: DigestJob[] = rawJobs.map((j) => {
    const base: DigestJob = {
      id: j.id,
      title: j.title,
      company: j.company,
      url: j.url,
      city: j.city ?? null,
      workMode: j.work_mode ?? "unknown",
      score: j.score,
      scoreBand: j.score_band ?? "low",
      postedAt: j.posted_at ?? null,
      firstSeenAt: j.first_seen_at,
      titleBucket: j.title_bucket ?? "include",
    };

    // Attach AI fit data if available
    const fit = getFitAnalysis(j.id);
    if (fit) {
      base.fitScore = fit.fit_score;
      base.fitVerdict = fit.verdict;
      base.fitSummary = fit.summary;
    }

    return base;
  });

  const topPriority = jobs.filter((j) => j.score >= 80);
  const goodMatch = jobs.filter((j) => j.score >= 50 && j.score < 80);
  const worthALook = jobs.filter(
    (j) => j.score < 50 && j.titleBucket !== "maybe",
  );
  const maybeReview = jobs.filter((j) => j.titleBucket === "maybe");

  const emoji = digestType === "morning" ? "☀️" : "🌙";
  const headerLines: string[] = [
    `📬 ${emoji} <b>${digestType === "morning" ? "Morning" : "Evening"} Digest — ${dateStr}</b>`,
    ``,
    `📊 <b>${jobs.length}</b> new jobs found`,
  ];

  if (topPriority.length > 0)
    headerLines.push(`  🔴 Top Priority (80+): ${topPriority.length}`);
  if (goodMatch.length > 0)
    headerLines.push(`  🟡 Good Match (50-79): ${goodMatch.length}`);
  if (worthALook.length > 0)
    headerLines.push(`  🟢 Also Found (&lt;50): ${worthALook.length}`);
  if (maybeReview.length > 0)
    headerLines.push(`  ❓ Needs Review: ${maybeReview.length}`);

  if (jobs.length === 0) {
    headerLines.push(`\nNo new jobs since last digest. 🎉`);
  }

  return {
    header: headerLines.join("\n"),
    jobs,
    bands: { topPriority, goodMatch, worthALook, maybeReview },
  };
}

export function formatJobCard(job: DigestJob, index: number): string {
  const timeAgo = formatTimeAgo(job.postedAt ?? job.firstSeenAt);
  const location = escapeHtml(job.city ?? "Unknown");
  const mode =
    job.workMode !== "unknown" ? ` (${escapeHtml(job.workMode)})` : "";
  const title = escapeHtml(job.title);
  const company = escapeHtml(job.company);
  const applyUrl = safeHref(job.url);

  // Get alternate URLs from other sources
  const alternates = getAlternateUrls(job.id);
  const altLinks = alternates.length >= 2
    ? ` | ${alternates
        .slice(0, 2)
        .map((a) => `<a href="${safeHref(a.url)}">${escapeHtml(capitalize(a.source))}</a>`)
        .join(" | ")}`
    : alternates.length === 1
      ? ` | <a href="${safeHref(alternates[0].url)}">${escapeHtml(capitalize(alternates[0].source))}</a>`
      : "";

  const lines = [
    `<b>${index}.</b> [${job.score}] <b>${title}</b>`,
    `🏢 ${company} — 📍 ${location}${mode}`,
    `🕐 ${timeAgo} → <a href="${applyUrl}">Apply</a>${altLinks}`,
  ];

  // Add compact AI fit line if available
  if (job.fitScore !== undefined && job.fitVerdict) {
    const emoji =
      { strong: "🟢", moderate: "🟡", weak: "🟠", stretch: "🔴" }[
        job.fitVerdict
      ] ?? "⚪";
    lines.push(
      `🧠 AI: ${job.fitScore}/100 ${emoji} — ${escapeHtml(job.fitSummary ?? job.fitVerdict)}`,
    );
  }

  return lines.join("\n");
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

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
