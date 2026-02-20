import { logger } from "../logger";
import type { RawJob, ConnectorResult } from "../types";
import type { SourceDefinition } from "../config";
import {
  fetchPageParserJobs,
  loadCheerio,
  cleanText,
  generateJobId,
  type ParsedJob,
} from "./page-parser-base";

const WORKABLE_SELECTORS = {
  jobContainer: "[data-ui='job-item'], .job-item, .job",
  title: "a[href*='/jobs/'], .job-title, h3, h2",
  location: ".job-location, [data-ui='job-location'], .location",
  link: "a[href*='/jobs/']",
};

export async function fetchWorkableJobs(
  company: string,
  sourceConfig: SourceDefinition,
): Promise<ConnectorResult> {
  return fetchPageParserJobs(
    "workable",
    company,
    sourceConfig,
    parseWorkablePage,
  );
}

function parseWorkablePage(html: string, company: string, baseUrl: string): ParsedJob[] {
  const $ = loadCheerio(html);
  const jobs: ParsedJob[] = [];

  const baseHostname = new URL(baseUrl).hostname;

  $(WORKABLE_SELECTORS.jobContainer).each((_i, el) => {
    try {
      const $job = $(el);

      const $titleLink = $job.find(WORKABLE_SELECTORS.title).first();
      let title = cleanText($titleLink.text());
      
      if (!title) {
        title = cleanText($job.find("h2, h3, h4").first().text());
      }

      if (!title) {
        return;
      }

      const $link = $job.find(WORKABLE_SELECTORS.link).first();
      const href = $link.attr("href") ?? "";
      
      let jobUrl: string;
      if (href.startsWith("http")) {
        jobUrl = href;
      } else if (href.startsWith("/")) {
        jobUrl = `https://${baseHostname}${href}`;
      } else {
        jobUrl = `https://${baseHostname}/jobs/${href}`;
      }

      const location = cleanText($job.find(WORKABLE_SELECTORS.location).text());

      const description = cleanText($job.text());

      const sourceJobId = generateJobId("workable", company, title);

      jobs.push({
        sourceJobId,
        title,
        url: jobUrl,
        locationRaw: location,
        postedAt: null,
        content: description,
      });
    } catch (error) {
      logger.warn(`Workable/${company}: failed to parse job: ${error}`);
    }
  });

  if (jobs.length === 0) {
    const alternativeJobs = tryAlternativeParsing($, company, baseHostname);
    jobs.push(...alternativeJobs);
  }

  return jobs;
}

function tryAlternativeParsing(
  $: ReturnType<typeof loadCheerio>,
  company: string,
  baseHostname: string,
): ParsedJob[] {
  const jobs: ParsedJob[] = [];

  $("a[href*='/jobs/']").each((_i, el) => {
    try {
      const $link = $(el);
      const href = $link.attr("href") ?? "";
      
      if (!href || href === "/jobs/" || href === "jobs/") {
        return;
      }

      const title = cleanText($link.text());
      if (!title || title.length < 3) {
        return;
      }

      let jobUrl: string;
      if (href.startsWith("http")) {
        jobUrl = href;
      } else if (href.startsWith("/")) {
        jobUrl = `https://${baseHostname}${href}`;
      } else {
        jobUrl = `https://${baseHostname}/${href}`;
      }

      const $parent = $link.closest("div, li, article, section");
      const location = cleanText($parent.find(".location, [class*='location']").text());

      const sourceJobId = generateJobId("workable", company, title);

      jobs.push({
        sourceJobId,
        title,
        url: jobUrl,
        locationRaw: location,
        postedAt: null,
        content: title,
      });
    } catch (error) {
      // Silently skip malformed entries during alternative parsing
    }
  });

  return jobs;
}
