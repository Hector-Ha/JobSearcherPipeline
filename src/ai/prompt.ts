import type { FitAnalysis } from "./types";

const SYSTEM_PROMPT = `You are an expert career advisor analyzing job fit. Given a candidate's resume and a job description, provide a thorough fit analysis.

You MUST return ONLY a valid JSON object with these exact fields:
{
  "fitScore": <number 0-100>,
  "verdict": "<strong|moderate|weak|stretch>",
  "summary": "<2-3 sentence assessment>",
  "strengths": ["<matching qualification 1>", ...],
  "gaps": ["<missing requirement 1>", ...],
  "keySkillsMatched": ["<skill 1>", ...],
  "keySkillsMissing": ["<skill 1>", ...],
  "keySkillsBonus": ["<extra valuable skill 1>", ...],
  "experienceLevelMatch": "<matches|under-qualified|over-qualified>",
  "domainRelevance": "<brief note on industry/domain fit>",
  "recommendation": "<one actionable sentence>",
  "resumeTailoringTips": ["<specific tip 1>", ...],
  "coverLetterPoints": ["<key point 1>", ...]
}

Scoring guide:
- fitScore 80-100 → verdict "strong": Candidate meets most/all requirements
- fitScore 50-79 → verdict "moderate": Solid overlap with some gaps
- fitScore 20-49 → verdict "weak": Significant gaps but some transferable skills
- fitScore 0-19 → verdict "stretch": Major skill/experience mismatch

Rules:
- Be honest but constructive — identify real gaps without being discouraging
- Focus on TECHNICAL skills, experience level, and domain relevance
- resumeTailoringTips should be specific and actionable (e.g. "Highlight your X experience from Y project")
- coverLetterPoints should be compelling angles to emphasize
- keySkillsBonus are resume skills NOT in the JD that still add value
- Return ONLY the JSON object, no markdown, no explanation outside JSON`;

export function buildPrompt(
  resume: string,
  jobTitle: string,
  company: string,
  jobDescription: string,
): string {
  return [
    `=== CANDIDATE RESUME ===`,
    resume,
    ``,
    `=== JOB POSTING ===`,
    `Title: ${jobTitle}`,
    `Company: ${company}`,
    ``,
    `Description:`,
    jobDescription,
    ``,
    `Analyze how well this candidate fits this role. Return ONLY a JSON object.`,
  ].join("\n");
}

export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const MAX_JD_LENGTH = 8000;

export function truncateDescription(text: string): string {
  if (text.length <= MAX_JD_LENGTH) return text;
  return text.substring(0, MAX_JD_LENGTH) + "\n\n[...truncated for length]";
}

export function parseAIResponse(
  raw: string,
): Omit<
  FitAnalysis,
  "modelUsed" | "provider" | "promptTokens" | "completionTokens"
> | null {
  try {
    let jsonStr = raw.trim();

    // Strip  blocks (some models output reasoning before JSON)
    jsonStr = jsonStr.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

    // Strip markdown code fences if present
    const jsonMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    const parsed = JSON.parse(jsonStr);

    // Validate required fields
    if (
      typeof parsed.fitScore !== "number" ||
      typeof parsed.verdict !== "string" ||
      typeof parsed.summary !== "string"
    ) {
      return null;
    }

    // Clamp fitScore to 0-100
    parsed.fitScore = Math.max(0, Math.min(100, Math.round(parsed.fitScore)));

    // Ensure arrays are arrays
    const arrayFields = [
      "strengths",
      "gaps",
      "keySkillsMatched",
      "keySkillsMissing",
      "keySkillsBonus",
      "resumeTailoringTips",
      "coverLetterPoints",
    ];
    for (const field of arrayFields) {
      if (!Array.isArray(parsed[field])) {
        parsed[field] = [];
      }
    }

    // Ensure string fields
    parsed.experienceLevelMatch = parsed.experienceLevelMatch ?? "unknown";
    parsed.domainRelevance = parsed.domainRelevance ?? "";
    parsed.recommendation = parsed.recommendation ?? "";

    return parsed;
  } catch {
    return null;
  }
}

export { SYSTEM_PROMPT };
