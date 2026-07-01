export const FATIGUE_WORDS = [
  "leverage",
  "unlock",
  "seamless",
  "robust",
  "cutting-edge",
  "game-changer",
  "empower",
  "delve",
  "tapestry",
  "holistic",
  "streamline",
  "revolutionize",
  "synergy",
  "paradigm",
  "landscape",
  "navigate",
  "elevate",
  "harness",
  "foster",
  "spearhead",
];

export const TECHNICAL_ALLOWLIST = new Set(["robust", "streamline", "landscape"]);

export const FORBIDDEN_PATTERNS = [
  { id: "fast-paced", pattern: /\bin today(?:'s|s) fast[- ]paced\b/i, label: "In today's fast-paced…" },
  { id: "no-secret", pattern: /\bit(?:'s| is) no secret that\b/i, label: "It's no secret that…" },
  { id: "whether-or", pattern: /\bwhether you(?:'re| are) a .+ or a .+\b/i, label: "Whether you're a… or a…" },
  { id: "in-conclusion", pattern: /\bin conclusion\b/i, label: "In conclusion" },
  { id: "at-the-end", pattern: /\bat the end of the day\b/i, label: "At the end of the day" },
  { id: "look-no-further", pattern: /\blook no further\b/i, label: "Look no further" },
  { id: "dive-deep", pattern: /\bdive deep(?:er)? into\b/i, label: "Dive deep into" },
];

export const GENERIC_FILLER_PATTERNS = [
  /\bpractical guide\b/i,
  /\bstreamline (?:your )?workflow\b/i,
  /\btake your .+ to the next level\b/i,
  /\bcomprehensive solution\b/i,
  /\bone-stop shop\b/i,
  /\bwithout further ado\b/i,
  /\bin this (?:article|guide|post), we(?:'ll| will)\b/i,
];

export const VOICE_RULES = {
  sharp: [
    "Lead with the reader problem in the first sentence.",
    "Use short sentences. Cut filler adjectives.",
    "Name concrete product actions, not abstract benefits.",
    "End sections with a specific next step, not a summary.",
  ],
  editorial: [
    "Open with a scene or tension the reader recognizes.",
    "Vary sentence length; avoid three parallel clauses in a row.",
    "Ground claims in site evidence, not generic industry wisdom.",
    "Prefer active voice and specific nouns over buzzwords.",
  ],
  technical: [
    "Explain the workflow step-by-step with precise verbs.",
    "Name inputs, outputs, and constraints from the product.",
    "Avoid marketing superlatives; let features speak.",
    "Use consistent terminology from crawled site pages.",
  ],
  friendly: [
    "Write like a helpful teammate, not a press release.",
    "Use you/we naturally; avoid corporate third person.",
    "Keep jargon minimal; define terms on first use.",
    "Celebrate small wins the reader can achieve today.",
  ],
};

export const GROUNDING_RULES = [
  "Use siteContext pages as the source of truth for product facts.",
  "Every evidenceRefs item must cite a real crawled page URL.",
  "Do not invent customer names, traffic numbers, rankings, or citations.",
  "If coverage is weak, say so in qaChecks instead of pretending.",
  "Prefer refreshing an overlapping existing URL over a cannibalizing new path.",
];

export const detectFatigueWords = (text, voice = "editorial") => {
  const lower = String(text || "").toLowerCase();
  const hits = [];
  for (const word of FATIGUE_WORDS) {
    const regex = new RegExp(`\\b${word}\\b`, "i");
    if (regex.test(lower)) {
      const severity = voice === "technical" && TECHNICAL_ALLOWLIST.has(word) ? "warn" : "fail";
      hits.push({ word, severity });
    }
  }
  return hits;
};

export const detectForbiddenPatterns = (text) => {
  const hits = [];
  for (const entry of FORBIDDEN_PATTERNS) {
    if (entry.pattern.test(String(text || ""))) {
      hits.push({ id: entry.id, label: entry.label });
    }
  }
  return hits;
};

export const detectGenericFiller = (text) =>
  GENERIC_FILLER_PATTERNS.filter((pattern) => pattern.test(String(text || ""))).map((pattern) => pattern.source);

export const buildAntiAiRules = (voice = "editorial") => ({
  fatigueWords: FATIGUE_WORDS,
  forbiddenPatterns: FORBIDDEN_PATTERNS.map((entry) => entry.label),
  genericFiller: GENERIC_FILLER_PATTERNS.map((pattern) => pattern.source),
  structuralRules: [
    "Do not start three consecutive sentences with the same word.",
    "Do not open every section with a rhetorical question.",
    "Do not end with an 'In conclusion' summary paragraph.",
    "Avoid three or more parallel short sentences in a row.",
  ],
  voice,
  technicalAllowlist: voice === "technical" ? [...TECHNICAL_ALLOWLIST] : [],
});
