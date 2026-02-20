import { logger } from "../logger";
import { serpApiSearch } from "./serpapi";
import type { RawJob, ConnectorResult } from "../types";

interface SearchItem {
  title: string;
  link: string;
  snippet: string;
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parseSnippetPostedAt(text: string): string | null {
  const raw = text.toLowerCase();
  const now = new Date();

  if (/\btoday\b/.test(raw)) {
    return toIsoDate(now);
  }
  if (/\byesterday\b/.test(raw)) {
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    return toIsoDate(d);
  }

  const daysAgoMatch = raw.match(/\b(\d+)\s+days?\s+ago\b/);
  if (daysAgoMatch) {
    const days = Number.parseInt(daysAgoMatch[1], 10);
    if (Number.isFinite(days) && days >= 0) {
      const d = new Date(now);
      d.setDate(d.getDate() - days);
      return toIsoDate(d);
    }
  }

  const weeksAgoMatch = raw.match(/\b(\d+)\s+weeks?\s+ago\b/);
  if (weeksAgoMatch) {
    const weeks = Number.parseInt(weeksAgoMatch[1], 10);
    if (Number.isFinite(weeks) && weeks >= 0) {
      const d = new Date(now);
      d.setDate(d.getDate() - weeks * 7);
      return toIsoDate(d);
    }
  }

  const hoursAgoMatch = raw.match(/\b(\d+)\s+hours?\s+ago\b/);
  if (hoursAgoMatch) {
    const hours = Number.parseInt(hoursAgoMatch[1], 10);
    if (Number.isFinite(hours) && hours >= 0) {
      const d = new Date(now.getTime() - hours * 60 * 60 * 1000);
      return toIsoDate(d);
    }
  }

  const shortDateMatch = raw.match(
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2}(?:,\s*\d{4})?\b/i,
  );
  if (shortDateMatch) {
    const parsed = Date.parse(shortDateMatch[0]);
    if (!Number.isNaN(parsed)) {
      return toIsoDate(new Date(parsed));
    }
  }

  return null;
}

function cleanTitle(title: string): string {
  return title
    .replace(/\s*[-|–—]\s*.*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractCompany(title: string): string {
  const atPattern = /\bat\s+([A-Z][A-Za-z0-9&.\- ]{1,60})/i;
  const atMatch = title.match(atPattern);
  if (atMatch?.[1]) {
    return atMatch[1].trim();
  }

  const separators = [" - ", " | ", " – ", " — "];
  for (const sep of separators) {
    const idx = title.indexOf(sep);
    if (idx > 0) {
      return title.slice(0, idx).trim();
    }
  }
  return "Unknown Company";
}

function extractLocation(snippet: string): string {
  const locationPatterns = [
    /\b(Toronto|Mississauga|Brampton|Vancouver|Waterloo|Ottawa|Remote)\b/i,
    /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?,\s*(?:ON|BC|AB|QC|CA))/i,
  ];

  for (const pattern of locationPatterns) {
    const match = snippet.match(pattern);
    if (match) {
      return match[1];
    }
  }
  return "";
}

function toRawJob(item: SearchItem, source: string): RawJob {
  const title = cleanTitle(item.title || "Untitled Job");
  const company = extractCompany(item.title || "");
  const locationRaw = extractLocation(item.snippet || "");
  const sourceJobId = `serp-${Buffer.from(item.link).toString("base64").slice(0, 16)}`;
  const postedAt = parseSnippetPostedAt(`${item.title} ${item.snippet}`);

  return {
    source,
    sourceJobId,
    title,
    company,
    url: item.link,
    locationRaw,
    postedAt,
    originalTimezone: null,
    content: item.snippet || item.title || "",
    rawPayload: JSON.stringify(item),
  };
}

function isLikelyJob(item: SearchItem): boolean {
  const text = `${item.title} ${item.snippet}`.toLowerCase();
  const noisyListingPatterns = [
    /^\d[\d,\s+]*\bjobs?\b.*\bin\b/i,
    /\bjobs?\s+in\s+[a-z].*\b(today|this week|february|march|april|may|june|july|august|september|october|november|december)\b/i,
    /\bsearch results\b/i,
  ];
  if (noisyListingPatterns.some((pattern) => pattern.test(item.title))) {
    return false;
  }

  const blockedRoleTerms = [
    "business developer",
    "business development",
    "sales",
    "account executive",
    "marketing",
    "recruiter",
    "data scientist",
    "machine learning engineer",
  ];
  if (blockedRoleTerms.some((term) => text.includes(term))) {
    return false;
  }

  const targetRoleTerms = [
    "software engineer",
    "software developer",
    "web developer",
    "frontend",
    "front end",
    "backend",
    "back end",
    "full stack",
    "full-stack",
    "devops",
    "platform engineer",
    "data engineer",
    "application developer",
  ];
  return targetRoleTerms.some((k) => text.includes(k));
}

function isLikelyPostingUrl(url: string): boolean {
  const lower = url.toLowerCase();

  if (lower.includes("linkedin.com")) {
    return /linkedin\.com\/jobs\/view\/\d+/.test(lower);
  }
  if (lower.includes("indeed.")) {
    return (
      /\/viewjob/.test(lower) ||
      /\/rc\/clk/.test(lower) ||
      /\/pagead\/clk/.test(lower)
    );
  }
  if (lower.includes("glassdoor.")) {
    return /glassdoor\.[a-z.]+\/job-listing\//.test(lower);
  }
  if (lower.includes("wellfound.com")) {
    return /wellfound\.com\/jobs\/\d+/.test(lower);
  }
  if (lower.includes("simplify.jobs")) {
    return /simplify\.jobs\/p\/[0-9a-f-]+\/[a-z0-9-]+/i.test(lower);
  }

  const rejectPatterns = [
    /\/jobs\?/,
    /\/m\/jobs\?/,
    /\/jobs$/,
    /\/jobs\/?$/,
    /linkedin\.com\/jobs\/search/,
    /linkedin\.com\/jobs\/collections/,
    /glassdoor\.[a-z.]+\/index\.htm/,
    /x\.com\/[^/]+$/,
  ];
  if (rejectPatterns.some((pattern) => pattern.test(lower))) {
    return false;
  }

  const allowPatterns = [
    /\/jobs\/\d+/,
    /\/viewjob/,
    /\/job\//,
    /\/careers\//,
    /\/positions\//,
    /\/openings\//,
  ];
  return allowPatterns.some((pattern) => pattern.test(lower));
}

export async function runSerpApiQueryPack(
  source: string,
  queries: string[],
): Promise<ConnectorResult> {
  const start = Date.now();
  const jobs: RawJob[] = [];
  const seenUrls = new Set<string>();
  let queryFailures = 0;
  const resultPageStarts = source === "serpapi-aggregators" ? [0, 10, 20] : [0];

  for (const query of queries) {
    for (const pageStart of resultPageStarts) {
      try {
        const result = await serpApiSearch({
          engine: "google",
          q: query,
          num: 10,
          start: pageStart,
          tbs: "qdr:w2",
        });

        const items = (result.organic_results ?? []).map((r) => ({
          title: r.title ?? "",
          link: r.link ?? "",
          snippet: r.snippet ?? "",
        }));

        for (const item of items) {
          if (!item.link || seenUrls.has(item.link)) continue;
          if (!isLikelyJob(item)) continue;
          if (!isLikelyPostingUrl(item.link)) continue;

          seenUrls.add(item.link);
          jobs.push(toRawJob(item, source));
        }

        // Keep API usage polite in personal-use mode.
        await new Promise((resolve) => setTimeout(resolve, 1200));
      } catch (error) {
        queryFailures++;
        logger.warn(
          `SerpApi/${source} query failed (start=${pageStart}): ${String(error)}`,
        );
      }
    }
  }

  logger.info(
    `SerpApi/${source}: ${queries.length} queries x ${resultPageStarts.length} pages, ${jobs.length} candidate jobs, ${queryFailures} query failures`,
  );

  if (queryFailures >= queries.length * resultPageStarts.length && queries.length > 0) {
    return {
      source,
      company: "serpapi",
      jobs: [],
      success: false,
      error: "All SerpApi queries failed",
      responseTimeMs: Date.now() - start,
      rateLimited: false,
    };
  }

  return {
    source,
    company: "serpapi",
    jobs,
    success: true,
    responseTimeMs: Date.now() - start,
    rateLimited: false,
  };
}

export const DEFAULT_AGGREGATOR_QUERIES = [
  'site:ca.linkedin.com/jobs/view ("software engineer" OR "software developer" OR "frontend developer" OR "backend developer" OR "full stack developer") ("Toronto" OR "Mississauga" OR "Vancouver") ("entry level" OR "new grad" OR "junior" OR "intermediate") -senior -staff -lead -principal -manager -director',
  'site:ca.indeed.com/viewjob ("software engineer" OR "software developer" OR "web developer" OR "full stack developer") ("Toronto" OR "Mississauga" OR "Vancouver") ("entry level" OR "new grad" OR "junior" OR "intermediate") -senior -staff -lead -principal -manager -director',
  'site:glassdoor.ca/job-listing ("software engineer" OR "software developer" OR "frontend" OR "backend" OR "full stack") ("Toronto" OR "Mississauga" OR "Vancouver") ("entry level" OR "junior" OR "intermediate") -senior -staff -lead -principal -manager -director',
  'site:eluta.ca ("software engineer" OR "software developer" OR "web developer") ("Toronto" OR "Mississauga" OR "Ontario" OR "Vancouver" OR "BC") ("entry level" OR "junior" OR "intermediate") -senior -staff -lead -principal -manager -director',
  'site:wellfound.com/jobs ("software engineer" OR "full stack" OR "frontend" OR "backend") ("Canada" OR "Toronto" OR "Vancouver" OR "Remote") ("entry level" OR "junior" OR "intermediate") -senior -staff -lead -principal -manager -director',
  'site:simplify.jobs/p ("software engineer" OR "software developer" OR "web developer" OR "frontend developer" OR "backend developer" OR "full stack developer") ("Toronto" OR "Mississauga" OR "Vancouver" OR "Canada") ("entry level" OR "new grad" OR "junior" OR "intermediate") -senior -staff -lead -principal -manager -director -internship',
];

export const DEFAULT_UNDERGROUND_QUERIES = [
  'site:github.com "hiring" "software engineer" "canada"',
  'site:news.ycombinator.com "who is hiring"',
  'site:x.com "hiring software engineer canada"',
  'site:betakit.com "hiring"',
  'site:communitech.ca "jobs"',
];
