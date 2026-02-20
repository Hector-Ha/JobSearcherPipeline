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

const BAMBOOHR_SELECTORS = {
  jobContainer: ".resumator-job, .job-listing, [data-job-id], .job-item, li",
  title: ".resumator-job-title, .job-title, a, h2, h3",
  location: ".resumator-job-location, .job-location, .location",
  link: "a",
};

export async function fetchBambooHRJobs(
  company: string,
  sourceConfig: SourceDefinition,
): Promise<ConnectorResult> {
  return fetchPageParserJobs(
    "bamboohr",
    company,
    sourceConfig,
    parseBambooHRPage,
  );
}

function parseBambooHRPage(html: string, company: string, baseUrl: string): ParsedJob[] {
  const $ = loadCheerio(html);
  const jobs: ParsedJob[] = [];

  const baseHostname = new URL(baseUrl).hostname;

  $(BAMBOOHR_SELECTORS.jobContainer).each((_i, el) => {
    try {
      const $job = $(el);

      let title = cleanText($job.find(BAMBOOHR_SELECTORS.title).first().text());
      
      if (!title) {
        title = cleanText($job.find("h2, h3, h4, a").first().text());
      }

      if (!title || title.length < 3) {
        return;
      }

      const $link = $job.find(BAMBOOHR_SELECTORS.link).first();
      const href = $link.attr("href") ?? "";
      
      if (!href) {
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

      const location = cleanText($job.find(BAMBOOHR_SELECTORS.location).text());

      const description = cleanText($job.text());

      const sourceJobId = generateJobId("bamboohr", company, title);

      jobs.push({
        sourceJobId,
        title,
        url: jobUrl,
        locationRaw: location,
        postedAt: null,
        content: description,
      });
    } catch (error) {
      logger.warn(`BambooHR/${company}: failed to parse job: ${error}`);
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

  $("a[href*='job'], a[href*='careers']").each((_i, el) => {
    try {
      const $link = $(el);
      const href = $link.attr("href") ?? "";
      
      if (!href || href === "#" || href === "/") {
        return;
      }

      const title = cleanText($link.text());
      if (!title || title.length < 3) {
        return;
      }

      if (title.toLowerCase().includes("apply") || 
          title.toLowerCase().includes("learn more") ||
          title.toLowerCase().includes("view all")) {
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

      const $parent = $link.closest("div, li, article, section, tr");
      const location = cleanText($parent.find(".location, [class*='location']").text());

      const sourceJobId = generateJobId("bamboohr", company, title);

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
