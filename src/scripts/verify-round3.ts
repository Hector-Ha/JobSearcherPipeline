import { scoreFreshness } from "../scoring";
import { batchFetch } from "../connectors/base";

async function testFutureScoring() {
  console.log("Testing Future Timestamp Scoring...");
  const config = {
    scoring: {
      freshness: {
        brackets: [
          { maxHours: 24, points: 100 },
          { maxHours: 48, points: 80 },
          { maxHours: null, points: 0 },
        ],
        lowConfidenceCap: 50,
      },
    },
  } as any;

  // Future date (1 hour from now)
  const futureDate = new Date(Date.now() + 3600000).toISOString();

  // This should log a warning and clamp to 0 hoursAgo -> max points
  const score = scoreFreshness(futureDate, futureDate, "high", config);
  console.log(`Score for future date: ${score}`);

  if (score === 100) {
    console.log("✅ Future date clamped to 0 hoursAgo (max score)");
  } else {
    console.error(`❌ Future date scoring incorrect: ${score}`);
    process.exit(1);
  }
}

async function testBatchFetchErrorHandling() {
  console.log("Testing batchFetch error handling...");
  const items = ["A", "ERROR", "C"];

  const fetchFn = async (item: string) => {
    if (item === "ERROR") throw new Error("Boom");
    return item;
  };

  try {
    const results = await batchFetch({
      items,
      fetchFn,
      rateLimiting: { batchSize: 3 } as any,
    });

    console.log(`Results: ${JSON.stringify(results)}`);

    if (
      results.length === 2 &&
      results.includes("A") &&
      results.includes("C")
    ) {
      console.log("✅ batchFetch survived error (Promise.allSettled worked)");
    } else {
      console.error("❌ batchFetch results incorrect");
      process.exit(1);
    }
  } catch (e) {
    console.error(`❌ batchFetch crashed: ${e}`);
    process.exit(1);
  }
}

async function run() {
  await testFutureScoring();
  await testBatchFetchErrorHandling();
  console.log("All Round 3 verification checks passed!");
}

run();
