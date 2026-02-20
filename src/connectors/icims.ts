import { logger } from "../logger";
import type { ConnectorResult } from "../types";
import type { SourceDefinition } from "../config";
import {
  fetchPageParserJobs,
  loadCheerio,
  cleanText,
  generateJobId,
  type ParsedJob,
} from "./page-parser-base";

const ICIMS_SELECTORS = {
  jobContainer:
    ".iCIMS_JobsTable tr, .iCIMS_JobsTable ul li, .iCIMS_JobsList li, .job, .job-listing",
  title: "a[href*='/jobs/'], .iCIMS_Anchor, h2, h3",
  location:
    ".iCIMS_JobsTableField, .iCIMS_JobLocation, .location, [class*='Location']",
  link: "a[href*='/jobs/']",
};

export async function fetchIcimsJobs(
  company: string,
  sourceConfig: SourceDefinition,
): Promise<ConnectorResult> {
  return fetchPageParserJobs("icims", company, sourceConfig, parseIcimsPage);
}

function parseIcimsPage(
  html: string,
  company: string,
  baseUrl: string,
): ParsedJob[] {
  const $ = loadCheerio(html);
  const jobs: ParsedJob[] = [];
  const seenUrls = new Set<string>();
  const baseOrigin = new URL(baseUrl).origin;

  $(ICIMS_SELECTORS.jobContainer).each((_i, el) => {
    try {
      const $job = $(el);

      let title = cleanText($job.find(ICIMS_SELECTORS.title).first().text());
      if (!title) {
        title = cleanText($job.find("h2, h3, h4, a").first().text());
      }
      if (!title || title.length < 3) {
        return;
      }

      const href = $job.find(ICIMS_SELECTORS.link).first().attr("href") ?? "";
      if (!href) {
        return;
      }

      const url = toAbsoluteUrl(href, baseOrigin);
      if (seenUrls.has(url)) {
        return;
      }
      seenUrls.add(url);

      const locationRaw = cleanText($job.find(ICIMS_SELECTORS.location).text());
      const sourceJobId = extractIcimsJobId(url, title, company);

      jobs.push({
        sourceJobId,
        title,
        url,
        locationRaw,
        postedAt: null,
        content: cleanText($job.text()),
      });
    } catch (error) {
      logger.warn(`iCIMS/${company}: failed to parse a listing row: ${error}`);
    }
  });

  if (jobs.length === 0) {
    jobs.push(...tryFallbackParsing($, company, baseOrigin, seenUrls));
  }

  return jobs;
}

function tryFallbackParsing(
  $: ReturnType<typeof loadCheerio>,
  company: string,
  baseOrigin: string,
  seenUrls: Set<string>,
): ParsedJob[] {
  const jobs: ParsedJob[] = [];

  $("a[href*='/jobs/']").each((_i, el) => {
    const $link = $(el);
    const href = $link.attr("href") ?? "";
    if (!href) {
      return;
    }

    const title = cleanText($link.text());
    if (!title || title.length < 3) {
      return;
    }

    const url = toAbsoluteUrl(href, baseOrigin);
    if (seenUrls.has(url)) {
      return;
    }
    seenUrls.add(url);

    const sourceJobId = extractIcimsJobId(url, title, company);
    const $parent = $link.closest("li, tr, div, article, section");
    const locationRaw = cleanText(
      $parent.find(".location, [class*='Location']").text(),
    );

    jobs.push({
      sourceJobId,
      title,
      url,
      locationRaw,
      postedAt: null,
      content: title,
    });
  });

  return jobs;
}

function toAbsoluteUrl(href: string, baseOrigin: string): string {
  if (href.startsWith("http")) {
    return href;
  }
  if (href.startsWith("/")) {
    return `${baseOrigin}${href}`;
  }
  return `${baseOrigin}/${href}`;
}

function extractIcimsJobId(
  url: string,
  title: string,
  company: string,
): string {
  const idMatch = url.match(/\/jobs\/(\d+)/i);
  if (idMatch?.[1]) {
    return idMatch[1];
  }
  return generateJobId("icims", company, title);
}
