import { batchFetch } from "../connectors/base";
import { fetchGreenhouseJobs } from "../connectors/greenhouse";
import { logger } from "../logger";

async function testBatchFetchConcurrency() {
  console.log("Testing batchFetch concurrency...");
  const items = [1, 2, 3, 4, 5];
  const delayMs = 200;

  const fetchFn = async (item: number) => {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return item;
  };

  const start = Date.now();
  await batchFetch({
    items: items.map(String),
    fetchFn: async (i) => fetchFn(Number(i)),
    rateLimiting: {
      batchSize: 5,
      delayBetweenRequestsMs: 0, // No forced delay, rely on parallel execution
      batchPauseMs: 0,
      maxRetries: 0,
      backoffStartMs: 0,
    },
  });
  const elapsed = Date.now() - start;

  console.log(`Batch of 5 items with ${delayMs}ms delay took ${elapsed}ms`);

  if (elapsed < delayMs * 2) {
    console.log("✅ batchFetch is running in parallel");
  } else {
    console.error("❌ batchFetch appears to be serial (took too long)");
    process.exit(1);
  }
}

async function testGreenhouseValidation() {
  console.log("Testing Greenhouse config validation...");
  try {
    // @ts-ignore - Intentional missing property
    await fetchGreenhouseJobs("test-company", {
      type: "greenhouse",
      // endpointTemplate is missing
    });
    console.error("❌ Greenhouse did NOT throw error for missing config");
    process.exit(1);
  } catch (e: any) {
    if (e.message.includes("Missing endpointTemplate")) {
      console.log("✅ Greenhouse threw correct validation error");
    } else {
      console.error(`❌ Greenhouse threw unexpected error: ${e.message}`);
      process.exit(1);
    }
  }
}

async function run() {
  await testBatchFetchConcurrency();
  await testGreenhouseValidation();
  console.log("All manual verification checks passed!");
}

run();
