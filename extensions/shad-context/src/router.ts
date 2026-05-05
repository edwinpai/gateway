/**
 * Task Router — classifies incoming prompts into lanes.
 *
 * Three lanes:
 *   fast   — casual chat, greetings, short messages. Skip Shad entirely.
 *   recall — factual lookups, reference questions. Run `shad context`.
 *   deep   — research, analysis, multi-step reasoning. Full Shad workflow.
 *
 * Design: NO LLM calls. Pure heuristics. Must complete in <1ms.
 */

export type Lane = "fast" | "recall" | "deep";

export type RouteResult = {
  lane: Lane;
  reason: string;
};

// ============================================================================
// Pattern sets
// ============================================================================

/** Explicit triggers that force deep lane regardless of other signals. */
const DEEP_TRIGGERS = [
  /\b(research|deep dive|thorough(ly)?|in[- ]depth|comprehensive(ly)?)\b/i,
  /\b(analyze|analysis|compare|comparison|evaluate|assess)\b/i,
  /\b(design|architect|plan|strategy|proposal|draft)\b/i,
  /\b(investigate|explore|review.*thoroughly)\b/i,
  /\b(pros?\s+(and|&)\s+cons?|trade[- ]?offs?|advantages?\s+(and|&)\s+disadvantages?)\b/i,
  /\b(how\s+should\s+(we|i)\s+(approach|handle|build|implement|design))\b/i,
  /\b(write\s+(a|an|the)\s+(report|whitepaper|document|proposal|plan|sow|brief))\b/i,
];

/** Patterns that indicate recall is needed — referencing stored knowledge. */
const RECALL_TRIGGERS = [
  /\b(what\s+did\s+(we|i|you)\s+(decide|discuss|say|agree))\b/i,
  /\b(remind\s+me|do\s+you\s+remember|what\s+was)\b/i,
  /\b(when\s+(is|was|did)|where\s+(is|was|did))\b/i,
  /\b(who\s+(is|was)|what('s|\s+is)\s+(the|my|our))\b/i,
  /\b(status\s+of|update\s+on|progress\s+on)\b/i,
  /\b(last\s+time|previously|earlier|before)\b/i,
  /\b(look\s+up|find|check|search\s+for)\b/i,
  /\b(how\s+do\s+(we|i)|how\s+does)\b/i,
  /\b(what\s+about|tell\s+me\s+about)\b/i,
  /\?(.*\?)?$/, // ends with question mark(s)
];

/** Patterns that indicate fast lane — no retrieval needed. */
const FAST_PATTERNS = [
  /^(hey|hi|hello|yo|sup|what'?s?\s*up|good\s*(morning|afternoon|evening|night)|gm|gn|thanks?|ty|ok|okay|sure|yep|yea|yeah|nah|no|yes|cool|nice|lol|haha|hmm|hm|ah|oh|wow|damn|dang|bruh|oof|bet|word|fs|fr|nvm|np|yw|wdym|idk|idc|imo|imho|tbh|fwiw|afaik|ngl|smh|fml|ikr|ftw|wtf|omg|brb|ttyl|gtg|lmk|hmu)[\s!.?]*$/i,
  /^(ok|okay|yep|yes|sure)?[\s,]*(please\s+)?(cont+inue|proceed|carry\s+on|keep\s+going)[\s!.?]*$/i,
  /^(👍|👎|🔥|❤️|😂|😭|🙏|💯|✅|❌|👀|🤔|😊|😎|🎉|💪|🤝|🫡|😤|🥲|💀|☠️|🤷|😑)+$/,
  /^(k|kk|mm|mhm|uh huh|aight|ight|alr|alright)[\s!.?]*$/i,
];

/** System/meta prompts that should never trigger retrieval. */
const SYSTEM_PATTERNS = [
  /^(\/compact|\/status|\/help|\/restart|\/model|HEARTBEAT)/i,
  /^\[system\]/i,
  /^Continue the active task\./i,
  /^TASK_GOAL:/m,
  /^TASK_CRITERIA_(TOTAL|REMAINING):/m,
  /^NO_REPLY$/,
  /^HEARTBEAT_OK$/,
];

const SYSTEM_SUBSTRINGS = [
  /Read HEARTBEAT\.md if it exists/i,
  /If nothing needs attention, reply HEARTBEAT_OK/i,
];

/** Question words that strongly suggest recall lane. */
const QUESTION_STARTERS =
  /^(what|who|when|where|why|how|which|is|are|was|were|did|do|does|can|could|would|should|will)\b/i;

// ============================================================================
// Scoring
// ============================================================================

function countMatches(text: string, patterns: RegExp[]): number {
  let count = 0;
  for (const p of patterns) {
    if (p.test(text)) {
      count++;
    }
  }
  return count;
}

/**
 * Classify a prompt into a lane.
 *
 * Priority:
 *  1. System patterns → fast (always)
 *  2. Fast patterns → fast (exact match on short messages)
 *  3. Deep triggers → deep (explicit research/analysis language)
 *  4. Length heuristic → long complex messages lean deep
 *  5. Recall triggers → recall (questions, references)
 *  6. Default → recall (safe fallback — better to retrieve unnecessarily than miss context)
 */
export function classifyPrompt(prompt: string): RouteResult {
  const text = prompt.trim();

  // 1. System / meta
  for (const p of SYSTEM_PATTERNS) {
    if (p.test(text)) {
      return { lane: "fast", reason: "system/meta command" };
    }
  }
  for (const p of SYSTEM_SUBSTRINGS) {
    if (p.test(text)) {
      return { lane: "fast", reason: "system/meta prompt body" };
    }
  }

  // 2. Very short messages — check fast patterns
  if (text.length < 50) {
    for (const p of FAST_PATTERNS) {
      if (p.test(text)) {
        return { lane: "fast", reason: "casual/greeting" };
      }
    }
    // Short but not casual — check for reference-like keywords before fast-laning
    if (text.length < 15 && !QUESTION_STARTERS.test(text) && !text.includes("?")) {
      // Catch short reference phrases like "SOW status", "stripe balance", "workflow logs"
      const hasReferenceWord =
        /\b(status|balance|log|logs|check|update|info|details|config|cron|task|inbox)\b/i.test(
          text,
        );
      if (hasReferenceWord) {
        return { lane: "recall", reason: "short reference phrase" };
      }
      return { lane: "fast", reason: "very short, no question signal" };
    }
  }

  // 3. Deep triggers — explicit research/analysis language
  const deepScore = countMatches(text, DEEP_TRIGGERS);
  if (deepScore >= 2) {
    return { lane: "deep", reason: `${deepScore} deep triggers matched` };
  }
  if (deepScore === 1 && text.length > 60) {
    return { lane: "deep", reason: "deep trigger + substantial message" };
  }

  // 4. Length heuristic — very long messages with structure
  if (text.length > 300) {
    const hasStructure = /\n/.test(text) || /\d+\.\s/.test(text) || /[-•]\s/.test(text);
    if (hasStructure) {
      return { lane: "deep", reason: "long structured message" };
    }
  }

  // 5. Recall triggers
  const recallScore = countMatches(text, RECALL_TRIGGERS);
  if (recallScore > 0) {
    return { lane: "recall", reason: `${recallScore} recall triggers matched` };
  }

  // 6. Default: recall is the safe fallback
  // Better to retrieve context unnecessarily (12s cost) than miss it
  if (text.length >= 20) {
    return { lane: "recall", reason: "default (message >= 20 chars)" };
  }

  return { lane: "fast", reason: "short message, no signals" };
}
