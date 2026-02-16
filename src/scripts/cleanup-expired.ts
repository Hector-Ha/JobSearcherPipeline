import { logger } from "../logger";
import { initializeDatabase } from "../db";
import { getActiveJobsForValidation, markJobExpired } from "../db/operations";

const CONCURRENCY = 10;
const TIMEOUT_MS = 10_000;

async function checkUrl(job: { id: number; url: string }): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const headers = { "User-Agent": "JobSearchEngine/1.0" };

    // Fast path: check status code via HEAD request first
    const headResponse = await fetch(job.url, {
      method: "HEAD",
      headers,
      signal: controller.signal,
    });

    if (headResponse.status === 404 || headResponse.status === 410) {
      // Fallback to GET to confirm - some servers block HEAD but serve GET
      const getResponse = await fetch(job.url, {
        method: "GET",
        headers,
        signal: controller.signal,
      });

      if (getResponse.ok) {
        const html = (await getResponse.text()).toLowerCase();
        return (
          html.includes("position filled") ||
          html.includes("job is no longer available") ||
          html.includes("this job is no longer available") ||
          html.includes("posting has expired")
        );
      }

      return getResponse.status === 404 || getResponse.status === 410;
    }

    // HEAD returned 200 OK - check body for expired indicators
    if (headResponse.ok) {
      const getResponse = await fetch(job.url, {
        method: "GET",
        headers,
        signal: controller.signal,
      });
      const html = (await getResponse.text()).toLowerCase();
      return (
        html.includes("position filled") ||
        html.includes("job is no longer available") ||
        html.includes("this job is no longer available") ||
        html.includes("posting has expired")
      );
    }

    // HEAD returned 405 (Method Not Allowed) or other status - try GET
    if (headResponse.status === 405) {
      const getResponse = await fetch(job.url, {
        method: "GET",
        headers,
        signal: controller.signal,
      });

      if (getResponse.ok) {
        const html = (await getResponse.text()).toLowerCase();
        return (
          html.includes("position filled") ||
          html.includes("job is no longer available") ||
          html.includes("this job is no longer available") ||
          html.includes("posting has expired")
        );
      }

      return getResponse.status === 404 || getResponse.status === 410;
    }

    return false;
  } finally {
    clearTimeout(timeout);
  }
}

logger.info("Cleanup expired jobs triggered");

initializeDatabase();

const jobs = getActiveJobsForValidation(30);
logger.info(`Validating ${jobs.length} active job URLs (last 30 days)`);

let expiredCount = 0;
let checkedCount = 0;

for (let i = 0; i < jobs.length; i += CONCURRENCY) {
  const chunk = jobs.slice(i, i + CONCURRENCY);
  const results = await Promise.allSettled(
    chunk.map(async (job) => {
      try {
        const expired = await checkUrl(job);
        if (expired) {
          markJobExpired(job.id);
          expiredCount++;
          logger.info(`Marked expired: ${job.url}`);
        }
      } catch (error) {
        logger.warn(`URL check failed for ${job.url}: ${String(error)}`);
      }
    }),
  );
  checkedCount += chunk.length;
  logger.info(`  Progress: ${checkedCount}/${jobs.length}`);
}

logger.info(
  `Cleanup complete — checked: ${checkedCount}, marked expired: ${expiredCount}`,
);
