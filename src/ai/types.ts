export interface FitAnalysis {
  fitScore: number; // 0-100 overall match
  verdict: "strong" | "moderate" | "weak" | "stretch";
  summary: string; // 2-3 sentence overview

  // Strengths & Gaps (for resume tailoring)
  strengths: string[]; // What matches well
  gaps: string[]; // What's missing

  // Skills breakdown (machine-parseable for resume tailoring)
  keySkillsMatched: string[]; // Tech/skills on resume that JD wants
  keySkillsMissing: string[]; // Tech/skills JD wants but not on resume
  keySkillsBonus: string[]; // Resume skills that add extra value

  // Experience alignment
  experienceLevelMatch: string; // "matches" | "under-qualified" | "over-qualified"
  domainRelevance: string; // Brief note on industry/domain fit

  // Actionable output
  recommendation: string; // "Apply immediately" / "Worth tailoring" / "Stretch"
  resumeTailoringTips: string[]; // Specific suggestions to tailor resume
  coverLetterPoints: string[]; // Key points to emphasize

  // Metadata
  modelUsed: string;
  provider: "modal" | "groq";
  promptTokens: number;
  completionTokens: number;
}

export interface FitAnalysisRow {
  id: number;
  canonical_job_id: number;
  fit_score: number;
  verdict: string;
  summary: string;
  strengths_json: string;
  gaps_json: string;
  recommendation: string;
  skills_matched_json: string;
  skills_missing_json: string;
  skills_bonus_json: string;
  experience_level_match: string;
  domain_relevance: string;
  resume_tailoring_tips_json: string;
  cover_letter_points_json: string;
  model_used: string;
  provider: string;
  prompt_tokens: number;
  completion_tokens: number;
  analyzed_at: string;
}

export interface AIProviderConfig {
  name: string;
  endpoint: string;
  model: string;
  apiKey: string;
}
