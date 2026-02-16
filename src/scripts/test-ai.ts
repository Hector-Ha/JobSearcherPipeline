/**
 * Test script for AI fit analysis module.
 *
 * Usage: bun run src/scripts/test-ai.ts
 *
 * Tests the AI endpoint with a sample job description and validates
 * the response parses into a valid FitAnalysis object.
 */

import { analyzeFit } from "../ai";
import { loadConfig } from "../config";
import type { CanonicalJob } from "../types";

const SAMPLE_JOB_DESCRIPTION = `
<h2>Software Engineer - Full Stack</h2>
<p>We're looking for a Full Stack Software Engineer to join our team building
next-generation payment processing systems.</p>

<h3>What you'll do:</h3>
<ul>
  <li>Design and build scalable web applications using React and TypeScript</li>
  <li>Develop RESTful APIs with Node.js and Express</li>
  <li>Work with PostgreSQL and Redis for data storage</li>
  <li>Deploy services using Docker and Kubernetes</li>
  <li>Collaborate with product managers and designers</li>
</ul>

<h3>Requirements:</h3>
<ul>
  <li>3+ years of experience in full-stack development</li>
  <li>Strong proficiency in TypeScript and React</li>
  <li>Experience with Node.js backend development</li>
  <li>Familiarity with SQL databases and ORMs</li>
  <li>Experience with CI/CD pipelines and cloud platforms (AWS preferred)</li>
  <li>Knowledge of microservices architecture</li>
</ul>

<h3>Nice to have:</h3>
<ul>
  <li>Experience with GraphQL</li>
  <li>Knowledge of payment processing systems</li>
  <li>Contributions to open-source projects</li>
</ul>

<h3>Benefits:</h3>
<ul>
  <li>Competitive salary + equity</li>
  <li>Remote-first culture</li>
  <li>Health, dental, and vision insurance</li>
</ul>
`;

async function main() {
  console.log("═══════════════════════════════════════════════════");
  console.log("  AI Fit Analysis — Test Script");
  console.log("═══════════════════════════════════════════════════\n");

  // Load config
  const config = loadConfig();

  // Check API keys
  const hasModal = !!config.env.modalApiToken;
  const hasGroq = !!config.env.groqApiKey;

  console.log(`Modal API Token: ${hasModal ? "✅ configured" : "❌ not set"}`);
  console.log(`Groq API Key: ${hasGroq ? "✅ configured" : "❌ not set"}`);

  if (!hasModal && !hasGroq) {
    console.error(
      "\n❌ No AI providers configured. Set MODAL_API_TOKEN or GROQ_API_KEY in .env",
    );
    process.exit(1);
  }

  // Create a mock CanonicalJob
  const mockJob: CanonicalJob = {
    title: "Software Engineer - Full Stack",
    company: "Acme Payments Inc",
    source: "test",
    sourceJobId: "test-123",
    url: "https://example.com/jobs/123",
    city: "Toronto",
    province: "Ontario",
    country: "Canada",
    locationRaw: "Toronto, ON",
    locationTier: "tier1",
    workMode: "hybrid",
    score: 85,
    scoreFreshness: 30,
    scoreLocation: 35,
    scoreMode: 20,
    scoreBand: "topPriority",
    postedAt: new Date().toISOString(),
    postedAtConfidence: "high",
    originalTimezone: "America/Toronto",
    firstSeenAt: new Date().toISOString(),
    isReposted: false,
    originalPostDate: null,
    titleBucket: "include",
    status: "active",
    isBackfill: false,
    urlHash: "test-hash",
    contentFingerprint: "test-fingerprint",
  };

  console.log(
    "\n📋 Test job: Software Engineer - Full Stack @ Acme Payments Inc",
  );
  console.log("📍 Toronto, ON (hybrid)\n");

  // Force dryRun off for this test
  const testConfig = {
    ...config,
    env: { ...config.env, dryRun: false },
  };

  console.log("🤖 Calling AI endpoint...\n");
  const startTime = Date.now();

  const result = await analyzeFit(mockJob, SAMPLE_JOB_DESCRIPTION, testConfig);

  const elapsed = Date.now() - startTime;

  if (!result) {
    console.error("❌ AI analysis returned null — check logs above for errors");
    process.exit(1);
  }

  console.log("\n════════════════════════════════════════════════════");
  console.log("  ✅ Analysis Complete");
  console.log("════════════════════════════════════════════════════\n");

  console.log(`🧠 Fit Score: ${result.fitScore}/100`);
  console.log(`📊 Verdict: ${result.verdict}`);
  console.log(`📝 Summary: ${result.summary}`);
  console.log(`\n✅ Strengths:`);
  result.strengths.forEach((s) => console.log(`  • ${s}`));
  console.log(`\n❌ Gaps:`);
  result.gaps.forEach((g) => console.log(`  • ${g}`));
  console.log(`\n🔧 Skills Matched: ${result.keySkillsMatched.join(", ")}`);
  console.log(`❓ Skills Missing: ${result.keySkillsMissing.join(", ")}`);
  console.log(`⭐ Skills Bonus: ${result.keySkillsBonus.join(", ")}`);
  console.log(`\n📊 Experience Level: ${result.experienceLevelMatch}`);
  console.log(`🏢 Domain Relevance: ${result.domainRelevance}`);
  console.log(`💡 Recommendation: ${result.recommendation}`);
  console.log(`\n📝 Resume Tailoring Tips:`);
  result.resumeTailoringTips.forEach((t) => console.log(`  • ${t}`));
  console.log(`\n📄 Cover Letter Points:`);
  result.coverLetterPoints.forEach((p) => console.log(`  • ${p}`));
  console.log(`\n⚙️ Provider: ${result.provider} (${result.modelUsed})`);
  console.log(
    `📊 Tokens: ${result.promptTokens} prompt + ${result.completionTokens} completion`,
  );
  console.log(`⏱️ Time: ${elapsed}ms`);
}

main().catch(console.error);
