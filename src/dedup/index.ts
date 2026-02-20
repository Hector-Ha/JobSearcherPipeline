/**
 * Three-pass deduplication engine.
 * 1. URL hash — exact URL match
 * 2. Fuzzy key — (company + title + city) with fuse.js
 * 3. Content fingerprint — hash of description text
 * See FinalStrategy.md lines 380-403.
 */

import Fuse from "fuse.js";
import { logger } from "../logger";
import type { CanonicalJob, DedupResult } from "../types";
import {
  getJobByUrlHash,
  getJobByContentFingerprint,
  getRecentJobsForFuzzyDedup,
  insertDuplicateLink,
} from "../db/operations";

// Fuzzy Cache

type FuzzyJob = {
  id: number;
  company: string;
  title: string;
  city: string | null;
};

interface FuzzySearchable extends FuzzyJob {
  fuzzyKey: string;
}

let _fuzzyCache: FuzzySearchable[] | null = null;
let _fuseInstance: Fuse<FuzzySearchable> | null = null;

export function loadFuzzyCache(): void {
  const recentJobs = getRecentJobsForFuzzyDedup(7);
  _fuzzyCache = recentJobs.map((j) => ({
    ...j,
    fuzzyKey: buildFuzzyKey(j.company, j.title, j.city),
  }));
  _fuseInstance =
    _fuzzyCache.length > 0
      ? new Fuse(_fuzzyCache, {
          keys: ["fuzzyKey"],
          threshold: 0.3,
          includeScore: true,
        })
      : null;
}

export function clearFuzzyCache(): void {
  _fuzzyCache = null;
  _fuseInstance = null;
}

// Three-Pass Dedup

export function checkDuplicate(job: CanonicalJob): DedupResult {
  // Pass 1: URL hash (exact match)
  const urlMatch = getJobByUrlHash(job.urlHash);
  if (urlMatch) {
    return {
      isDuplicate: true,
      matchMethod: "url_hash",
      existingJobId: urlMatch.id,
    };
  }

  // Pass 2: Fuzzy key (company + title + city)
  const fuzzyResult = checkFuzzyDuplicate(job);
  if (fuzzyResult.isDuplicate) {
    return fuzzyResult;
  }

  // Pass 3: Content fingerprint
  if (job.contentFingerprint) {
    const fpMatch = getJobByContentFingerprint(job.contentFingerprint);
    if (fpMatch) {
      const daysSinceFirst =
        (Date.now() - new Date(fpMatch.first_seen_at).getTime()) /
        (1000 * 60 * 60 * 24);

      if (daysSinceFirst > 7) {
        return {
          isDuplicate: false,
          matchMethod: "content_fingerprint",
          existingJobId: fpMatch.id,
          isRepost: true,
          originalPostDate: fpMatch.posted_at ?? fpMatch.first_seen_at,
        };
      }

      return {
        isDuplicate: true,
        matchMethod: "content_fingerprint",
        existingJobId: fpMatch.id,
      };
    }
  }

  return { isDuplicate: false };
}

// Fuzzy Dedup

function checkFuzzyDuplicate(job: CanonicalJob): DedupResult {
  if (!_fuseInstance || !_fuzzyCache || _fuzzyCache.length === 0) {
    return { isDuplicate: false };
  }

  const newKey = buildFuzzyKey(job.company, job.title, job.city);
  const matches = _fuseInstance.search(newKey);

  if (matches.length > 0 && matches[0].score !== undefined) {
    const topMatch = matches[0];
    const similarity = 1 - topMatch.score!;

    if (similarity >= 0.85) {
      return {
        isDuplicate: true,
        matchMethod: "fuzzy_key",
        existingJobId: topMatch.item.id,
      };
    }

    if (similarity >= 0.7) {
      return {
        isDuplicate: true,
        matchMethod: "fuzzy_key",
        existingJobId: topMatch.item.id,
        isPotentialDuplicate: true,
      };
    }
  }

  return { isDuplicate: false };
}

function buildFuzzyKey(
  company: string,
  title: string,
  city: string | null,
): string {
  return [
    company.toLowerCase().trim(),
    title.toLowerCase().trim(),
    (city ?? "").toLowerCase().trim(),
  ]
    .filter(Boolean)
    .join(" | ");
}
