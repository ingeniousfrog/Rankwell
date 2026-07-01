import { buildAntiAiRules, GROUNDING_RULES, VOICE_RULES } from "./anti-ai-rules.js";
import {
  DRAFT_TEMPLATE_CATALOG,
  findIntentOverlapPage,
  getTemplatePromptInstructions,
  resolveDraftTemplate,
  suggestPlacementUrl,
} from "./draft-templates.js";

const truncateText = (content, maxChars) => {
  const text = String(content || "");
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}... [truncated]`;
};

const STOP_WORDS = new Set([
  "about",
  "best",
  "create",
  "free",
  "from",
  "generator",
  "guide",
  "how",
  "into",
  "maker",
  "tool",
  "video",
  "with",
  "your",
  "the",
  "and",
  "for",
]);

const tokenize = (text) =>
  String(text || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));

const pagePriority = (page) => {
  const type = page.pageType || "page";
  if (type === "home") return 0;
  if (type === "product" || type === "pricing") return 1;
  if (type === "comparison" || type === "docs") return 2;
  return 3;
};

export const scorePageRelevance = (page, queryTokens) => {
  if (!page || queryTokens.length === 0) return 0;
  let pathname = "";
  try {
    pathname = new URL(page.url).pathname.replace(/[-_/]+/g, " ");
  } catch {
    pathname = "";
  }
  const pageText = `${page.url} ${pathname} ${page.title || ""} ${page.h1 || ""} ${page.metaDescription || ""}`;
  const pageTokens = new Set(tokenize(pageText));
  const overlap = queryTokens.filter((token) => pageTokens.has(token)).length;
  const relevance = overlap / queryTokens.length;
  const priorityBoost = (4 - pagePriority(page)) * 0.05;
  return relevance + priorityBoost;
};

export const selectRelevantPages = (siteContext, { keyword = "", mustCover = [], maxPages = 8 } = {}) => {
  const queryTokens = [
    ...new Set([...tokenize(keyword), ...mustCover.flatMap((item) => tokenize(item))]),
  ];
  const pages = Array.isArray(siteContext?.pages) ? siteContext.pages : [];
  if (pages.length === 0) return [];

  const scored = pages
    .map((page) => ({ page, score: scorePageRelevance(page, queryTokens) }))
    .sort((left, right) => right.score - left.score || left.page.url.localeCompare(right.page.url));

  const overlap = findIntentOverlapPage(keyword, siteContext);
  const selected = [];
  const seen = new Set();

  if (overlap?.page?.url) {
    selected.push(overlap.page);
    seen.add(overlap.page.url);
  }

  for (const entry of scored) {
    if (selected.length >= maxPages) break;
    if (seen.has(entry.page.url)) continue;
    if (entry.score > 0 || selected.length < 3) {
      selected.push(entry.page);
      seen.add(entry.page.url);
    }
  }

  if (selected.length === 0) {
    return pages
      .sort((left, right) => pagePriority(left) - pagePriority(right))
      .slice(0, Math.min(maxPages, pages.length));
  }

  return selected.slice(0, maxPages);
};

const compactPageForCompose = (page, pageTextLimit = 1200) => ({
  url: page.url,
  pageTitle: page.title || page.h1 || page.url,
  pageType: page.pageType || "page",
  metaDescription: page.metaDescription || "",
  h1: page.h1 || "",
  h2: page.headings?.h2?.slice(0, 6) || [],
  pageText: truncateText(page.pageText || "", pageTextLimit),
});

export const buildRuleStack = (template, input = {}, draftIntent = null) => {
  const voice = String(input.voice || "editorial").toLowerCase();
  const voiceKey = Object.prototype.hasOwnProperty.call(VOICE_RULES, voice) ? voice : "editorial";

  return {
    templateRules: [
      `Template: ${template.label} (${template.id})`,
      ...String(template.promptSchema || "").split("\n").filter(Boolean),
    ],
    voiceRules: VOICE_RULES[voiceKey],
    antiAiRules: buildAntiAiRules(voiceKey),
    groundingRules: GROUNDING_RULES,
    intentRules: draftIntent
      ? [
          `Angle: ${draftIntent.angle || ""}`,
          `Reader problem: ${draftIntent.readerProblem || ""}`,
          `Must cover: ${(draftIntent.mustCover || []).join("; ")}`,
          `Must avoid: ${(draftIntent.mustAvoid || []).join("; ")}`,
        ]
      : [],
  };
};

export const composeDraftContext = ({
  input = {},
  calendarItem = {},
  siteContext = null,
  draftIntent = null,
  existingTitles = [],
}) => {
  const template = resolveDraftTemplate(calendarItem);
  const placementSuggestion = suggestPlacementUrl(calendarItem, siteContext, input);
  const mustCover = Array.isArray(draftIntent?.mustCover) ? draftIntent.mustCover : [];
  const selectedPages = selectRelevantPages(siteContext, {
    keyword: calendarItem.keyword || "",
    mustCover,
    maxPages: 8,
  });

  const urlStrategy =
    placementSuggestion.strategy === "refresh"
      ? {
          strategy: "refresh",
          targetUrl: placementSuggestion.url,
          reason: placementSuggestion.reason,
        }
      : draftIntent?.urlStrategy?.strategy === "refresh" && draftIntent.urlStrategy.targetUrl
        ? draftIntent.urlStrategy
        : {
            strategy: placementSuggestion.strategy,
            targetUrl: placementSuggestion.url,
            reason: placementSuggestion.reason,
          };

  const ruleStack = buildRuleStack(template, input, draftIntent);

  return {
    input,
    calendarItem,
    existingTitles: existingTitles.slice(0, 30),
    template: { id: template.id, label: template.label },
    templateInstructions: getTemplatePromptInstructions(template),
    intent: draftIntent,
    urlStrategy,
    placementSuggestion,
    ruleStack,
    siteSummary: {
      ok: Boolean(siteContext?.ok),
      domain: siteContext?.domain || input.domain || "",
      startUrl: siteContext?.startUrl || input.url || "",
      pageCount: selectedPages.length,
    },
    pages: selectedPages.map((page) => compactPageForCompose(page)),
  };
};

export const compactSiteContextForPlan = (siteContext) => {
  if (!siteContext || typeof siteContext !== "object") {
    return { ok: false, pages: [] };
  }
  const pages = (siteContext.pages || []).slice(0, 16).map((page) => ({
    url: page.url,
    pageTitle: page.title || page.h1 || page.url,
    pageType: page.pageType || "page",
    metaDescription: truncateText(page.metaDescription || "", 200),
    h1: page.h1 || "",
  }));
  return {
    ok: Boolean(siteContext.ok),
    domain: siteContext.domain,
    startUrl: siteContext.startUrl,
    pages,
  };
};
