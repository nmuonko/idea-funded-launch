/**
 * Search Fallback Gate — Decides whether AI-powered query interpretation is needed.
 *
 * Evaluates first-pass search quality + query characteristics to determine
 * if the expensive AI interpreter should be invoked for a second-pass search.
 *
 * Design principles:
 *  - Healthy English exact-match searches NEVER trigger AI
 *  - French/mixed queries with low results DO trigger AI
 *  - Typo-heavy or vague queries trigger AI
 *  - Cached AI interpretations are cheap, so the gate is slightly liberal
 *    when language ambiguity is detected
 */

import type { LanguageDetectionResult } from "./languageDetector.ts";

export interface FallbackGateInput {
  /** Number of results from first-pass search */
  firstPassResultCount: number;
  /** Language detection result */
  langDetection: LanguageDetectionResult;
  /** Whether static map or dynamic normalizer already translated */
  translationApplied: boolean;
  /** Whether AI rewrite already ran and improved results */
  aiRewriteApplied: boolean;
  /** Whether pre-normalizer matched */
  preNormMatched: boolean;
  /** Original query */
  rawQuery: string;
  /** Normalized query used for search */
  normalizedQuery: string;
  /** Whether this is page 0 (tighter budget) */
  isFirstPage: boolean;
  /** Whether the query is a known "direct" query (model tokens) */
  isDirectQuery: boolean;
}

export interface FallbackGateResult {
  /** Whether AI fallback should be triggered */
  shouldFallback: boolean;
  /** Reason for the decision */
  reason: string;
  /** Confidence that fallback will help (0-1) */
  expectedBenefit: number;
  /** Signals that contributed to the decision */
  signals: string[];
}

// Thresholds
const LOW_RESULT_THRESHOLD = 10;
const VERY_LOW_RESULT_THRESHOLD = 3;
const ZERO_RESULT_THRESHOLD = 0;

/**
 * Evaluate whether AI fallback interpreter should be called.
 *
 * Returns shouldFallback=true when there's a reasonable chance
 * that AI interpretation will produce better results.
 */
export function evaluateFallbackGate(input: FallbackGateInput): FallbackGateResult {
  const signals: string[] = [];
  let score = 0; // Higher = more likely to benefit from AI

  // ─── Signal 1: Result count ──────────────────────────────────────────────
  if (input.firstPassResultCount === ZERO_RESULT_THRESHOLD) {
    score += 5;
    signals.push("zero_results");
  } else if (input.firstPassResultCount <= VERY_LOW_RESULT_THRESHOLD) {
    score += 3;
    signals.push("very_low_results");
  } else if (input.firstPassResultCount <= LOW_RESULT_THRESHOLD) {
    score += 1;
    signals.push("low_results");
  }

  // ─── Signal 2: Language ──────────────────────────────────────────────────
  if (input.langDetection.detectedLang === "fr") {
    score += 2;
    signals.push("french_detected");
  } else if (input.langDetection.detectedLang === "mixed") {
    score += 3;
    signals.push("mixed_language");
  } else if (input.langDetection.detectedLang === "unknown") {
    score += 1;
    signals.push("unknown_language");
  }

  // ─── Signal 3: Unresolved French tokens ──────────────────────────────────
  if (input.langDetection.frenchTokens.length > 0 && !input.translationApplied) {
    score += 2;
    signals.push("untranslated_french");
  }

  // ─── Signal 4: Unknown tokens (potential typos or uncommon terms) ────────
  const unknownTokens = input.langDetection.tokens.filter(t => t.lang === "unknown");
  const totalNonBrand = input.langDetection.tokens.filter(t => t.lang !== "brand" && t.lang !== "model");
  if (totalNonBrand.length > 0) {
    const unknownRatio = unknownTokens.length / totalNonBrand.length;
    if (unknownRatio > 0.5) {
      score += 2;
      signals.push(`high_unknown_ratio:${unknownRatio.toFixed(2)}`);
    } else if (unknownRatio > 0.3) {
      score += 1;
      signals.push(`moderate_unknown_ratio:${unknownRatio.toFixed(2)}`);
    }
  }

  // ─── Signal 5: Query looks like natural language (long, with stop words) ─
  const wordCount = input.rawQuery.trim().split(/\s+/).length;
  if (wordCount >= 4) {
    score += 1;
    signals.push("long_query");
  }

  // ─── Negative signals (REDUCE score) ─────────────────────────────────────
  // Direct queries (known model tokens) rarely benefit from AI
  if (input.isDirectQuery) {
    score -= 3;
    signals.push("direct_query_penalty");
  }

  // Pre-normalizer already matched well
  if (input.preNormMatched && input.firstPassResultCount > LOW_RESULT_THRESHOLD) {
    score -= 2;
    signals.push("preNorm_sufficient");
  }

  // AI rewrite already ran and was applied
  if (input.aiRewriteApplied) {
    score -= 2;
    signals.push("aiRewrite_already_applied");
  }

  // Good results → no need
  if (input.firstPassResultCount >= 30) {
    score -= 4;
    signals.push("healthy_results");
  }

  // ─── Decision ────────────────────────────────────────────────────────────
  // Threshold: score >= 3 triggers fallback
  const TRIGGER_THRESHOLD = 3;
  const shouldFallback = score >= TRIGGER_THRESHOLD;

  // Normalize score to 0-1 benefit estimate
  const expectedBenefit = Math.min(1, Math.max(0, score / 8));

  let reason: string;
  if (!shouldFallback) {
    reason = score <= 0 ? "healthy_search" : "below_threshold";
  } else if (input.firstPassResultCount === 0) {
    reason = "zero_results_recovery";
  } else if (input.langDetection.detectedLang === "mixed" || input.langDetection.detectedLang === "fr") {
    reason = "language_normalization";
  } else {
    reason = "low_quality_results";
  }

  return { shouldFallback, reason, expectedBenefit, signals };
}

/**
 * Quick check: should AI rewrite be attempted at all?
 * Used to gate the EAGER ai rewrite call (before search).
 * Only allows AI rewrite for queries that show language ambiguity
 * or are not clearly direct English product queries.
 */
export function shouldAttemptEagerAiRewrite(
  langDetection: LanguageDetectionResult,
  isDirectQuery: boolean,
  preNormMatched: boolean,
  isFrenchLikely: boolean,
): boolean {
  // Never for direct queries with no language ambiguity
  if (isDirectQuery && langDetection.detectedLang !== "fr" && langDetection.detectedLang !== "mixed") {
    return false;
  }
  // Always for French/mixed
  if (isFrenchLikely || langDetection.hasFrenchSignal) {
    return true;
  }
  // Skip if preNorm already handled it well
  if (preNormMatched) {
    return false;
  }
  // For unknown language, allow if query is ambiguous
  if (langDetection.detectedLang === "unknown" && langDetection.confidence < 0.5) {
    return true;
  }
  // English with high confidence → skip
  if (langDetection.detectedLang === "en" && langDetection.confidence >= 0.5) {
    return false;
  }
  return true;
}
