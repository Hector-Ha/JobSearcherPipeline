import { normalizeTimestamp } from "../normalizer";

function testDateParsing() {
  console.log("Testing Date Parsing...");

  const inputs = [
    "2026-02-16T12:00:00Z",
    "2026-02-16T07:00:00-05:00",
    "February 16, 2026",
    null,
    "Invalid Date String",
  ];

  for (const input of inputs) {
    const result = normalizeTimestamp(input);
    console.log(
      `Input: "${input}" -> Output: ${result.isoString} (Confidence: ${result.confidence})`,
    );

    if (input && !input.includes("Invalid")) {
      if (!result.isoString) {
        console.error("❌ Failed to parse valid date");
        process.exit(1);
      }
      // Basic check for ISO format and offset
      if (
        !result.isoString.includes("-05:00") &&
        !result.isoString.includes("-04:00")
      ) {
        console.warn(
          "⚠️ Warning: Output might not have correct Toronto offset (expected -05:00 or -04:00)",
        );
      }
    }
  }
  console.log("✅ Date parsing tests completed");
}

testDateParsing();
