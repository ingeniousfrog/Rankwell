import { FATIGUE_WORDS, FORBIDDEN_PATTERNS } from "./anti-ai-rules.js";
import { compactSiteContextForPlan } from "./draft-compose.js";
import {
  getTemplatePromptInstructions,
  resolveDraftTemplate,
} from "./draft-templates.js";
import { normalizePlanLength } from "./plan-length.js";
import { buildCrawlGapSummary } from "./site-grounding.js";

const MAX_CONTEXT_PAGES = 24;
const MIN_CONTEXT_PAGES = 3;
const MAX_PAGE_TEXT_CHARS = 1200;
const MIN_PAGE_TEXT_CHARS = 400;
const MAX_IMAGE_REFS = 4;
const MIN_IMAGE_REFS = 0;
const MAX_PROMPT_MESSAGE_CHARS = 24_000;

const byteLength = (value) => Buffer.byteLength(String(value || ""), "utf8");

export const truncateToMaxChars = (content, maxBytes, label = "truncated") => {
  const text = String(content || "");
  if (byteLength(text) <= maxBytes) return text;

  const omitted = byteLength(text) - maxBytes;
  const marker = `... [${label} ${omitted} chars]`;
  const markerBytes = byteLength(marker);
  let low = 0;
  let high = text.length;

  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (byteLength(text.slice(0, mid)) + markerBytes <= maxBytes) low = mid;
    else high = mid - 1;
  }

  return `${text.slice(0, low)}${marker}`;
};

const pagePriority = (page) => {
  const type = page.pageType || "page";
  if (type === "home") return 0;
  if (type === "product" || type === "pricing") return 1;
  if (type === "comparison" || type === "docs") return 2;
  return 3;
};

const selectPagesForPrompt = (pages, maxPages) =>
  [...pages]
    .sort((left, right) => pagePriority(left) - pagePriority(right) || left.url.localeCompare(right.url))
    .slice(0, maxPages);

const compactPageForPrompt = (page, { pageTextLimit = MAX_PAGE_TEXT_CHARS, imageLimit = MAX_IMAGE_REFS } = {}) => ({
  url: page.url,
  pageTitle: page.title || page.h1 || page.url,
  pageType: page.pageType || "page",
  metaDescription: page.metaDescription || "",
  h1: page.h1 || "",
  h2: page.headings?.h2?.slice(0, 6) || [],
  pageText: truncateToMaxChars(page.pageText || "", pageTextLimit, "pageText truncated"),
  images: imageLimit > 0 ? (page.images || []).slice(0, imageLimit) : [],
});

export const compactSiteContextForPrompt = (siteContext, options = {}) => {
  if (!siteContext || typeof siteContext !== "object") {
    return { ok: false, error: "No site context available.", pages: [] };
  }

  const maxPages = options.maxPages ?? MAX_CONTEXT_PAGES;
  const pageTextLimit = options.pageTextLimit ?? MAX_PAGE_TEXT_CHARS;
  const imageLimit = options.imageLimit ?? MAX_IMAGE_REFS;
  const pages = Array.isArray(siteContext.pages) ? siteContext.pages : [];

  return {
    ok: Boolean(siteContext.ok),
    error: siteContext.error || "",
    startUrl: siteContext.startUrl,
    domain: siteContext.domain,
    discovery: siteContext.discovery,
    summary: siteContext.summary,
    pages: selectPagesForPrompt(pages, maxPages).map((page) =>
      compactPageForPrompt(page, { pageTextLimit, imageLimit }),
    ),
    failures: Array.isArray(siteContext.failures) ? siteContext.failures.slice(0, 12) : [],
    crawlGaps: buildCrawlGapSummary(siteContext),
  };
};

export const shrinkSiteContextForPrompt = (siteContext, maxMessageChars = MAX_PROMPT_MESSAGE_CHARS) => {
  let maxPages = MAX_CONTEXT_PAGES;
  let pageTextLimit = MAX_PAGE_TEXT_CHARS;
  let imageLimit = MAX_IMAGE_REFS;

  let compact = compactSiteContextForPrompt(siteContext, { maxPages, pageTextLimit, imageLimit });
  let probe = byteLength(JSON.stringify({ siteContext: compact }));

  while (probe > maxMessageChars) {
    if (maxPages > MIN_CONTEXT_PAGES) {
      maxPages = Math.max(MIN_CONTEXT_PAGES, Math.ceil(maxPages / 2));
    } else if (pageTextLimit > MIN_PAGE_TEXT_CHARS) {
      pageTextLimit = Math.max(MIN_PAGE_TEXT_CHARS, Math.floor(pageTextLimit * 0.8));
    } else if (imageLimit > MIN_IMAGE_REFS) {
      imageLimit = 0;
    } else {
      break;
    }

    compact = compactSiteContextForPrompt(siteContext, { maxPages, pageTextLimit, imageLimit });
    probe = byteLength(JSON.stringify({ siteContext: compact }));
  }

  return compact;
};

const sharedInstructions = [
  "Return only strict JSON. Do not wrap it in markdown.",
  "Do not invent customer names, traffic numbers, rankings, citations, or external facts.",
  "Use siteContext as the source of truth. If siteContext has weak coverage, say so in qaChecks instead of pretending.",
  "Every evidenceRefs item must include a real page URL from siteContext and this shape: { url, pageTitle, source, quote, usedFor }.",
  "When visualPlan recommends generated png, include generation details with this shape: { recommended, reason, prompt, negativePrompt, referenceImages, altText }.",
  "referenceImages must be an array of real site image or page URLs from siteContext when useful; otherwise return an empty array.",
  "Keep copy concise but specific. Use English output. Prefer short strings over long prose.",
  "Before writing any draft, resolve the content template from calendarItem.placement and format.",
  "Never use blog article sections for product page or comparison page placements.",
  "If siteContext already has a page that overlaps the keyword intent, prefer refreshing that URL instead of proposing a cannibalizing new path.",
  "Never recommend placementUrl or refreshCandidates for URLs listed only in siteContext.failures or missing from siteContext.pages.",
  "If siteContext.crawlGaps.homepageAvailable is false, ground copy and refresh targets on siteContext.crawlGaps.recommendedGroundingPages instead of the homepage.",
  "Infer product category from crawled page copy and domain context. Do not rename video, lipsync, or avatar products as 'AI clipping' unless the site explicitly uses that phrase.",
];

export const buildWorkflowPrompt = (input, siteContext) => {
  const planLength = normalizePlanLength(input?.planLength);
  const includeDraft = input?.includeDraft === true;
  const draftInstructions = includeDraft
    ? [
        "For the requested starter draft, write exactly one day-1 draft. Resolve template from day-1 calendarItem.placement and format before writing it.",
        "Day-1 draft must include templateId, templateLabel, blocks or sections matching the resolved template, and qaChecks for template match, template structure, URL strategy, schema fit, site grounding, evidence grounding, and product copy.",
        getTemplatePromptInstructions(resolveDraftTemplate({ placement: "product page", format: "landing" })),
      ]
    : ["Do not write a starter draft in this response. Return drafts as an empty array."];
  return {
  instructions: [
    "You generate practical local site planning workflows from a full website crawl.",
    ...sharedInstructions,
    "First infer missing context from the supplied website URL, domain, and siteContext: product category, primary audience, conversion goal, and writing style.",
    "Use supplied category, audience, goal, or writing style only as user overrides when present.",
    "Set inputs.category, inputs.audience, inputs.goal, and inputs.voice to your final assumptions.",
    "inputs.voice must be one of: sharp, editorial, technical, friendly, founder.",
    "Make the output immediately usable by a founder, creator, or lean marketing team.",
    "Schema:",
    `{ inputs, strategy, keywords[6], calendar[${planLength}], drafts[${includeDraft ? 1 : 0}], checklist[8] }.`,
    `Return exactly ${planLength} calendar items and set inputs.planLength to ${planLength}.`,
    `Set inputs.includeDraft to ${includeDraft}.`,
    "strategy must include refreshCandidates[0-12]: { url, title, pageType, lastmod, reasons[], priority } for stale pages worth updating.",
    "Each keyword: { keyword, intent, format, commercialValue, difficulty, productFit, questionVariants[3] } using 1-5 numeric scores.",
    "questionVariants should be natural-language questions searchers ask (People Also Ask style).",
    "Each calendar item: { day, title, keyword, intent, format, placement }. placement says where the draft best fits, such as blog, product page, comparison page, docs, template gallery, or CMS collection.",
    "Calendar titles must be audience-facing headlines that a real searcher would click. Never write internal brief titles like 'Why X struggle with', 'Refresh angle:', 'Buyer guide inspired by', or ': the practical version'.",
    "Calendar titles should address the reader directly and reflect the target keyword intent.",
    ...draftInstructions,
    "placementUrl must be a concrete page target: an existing page URL from siteContext for refreshes, or a realistic new URL path on the same domain for net-new content.",
    "visualPlan.recommended must be one of: website screenshot, product screenshot, mermaid diagram, svg diagram, or generated png.",
  ].join("\n"),
  message: JSON.stringify({
    task: "Create an independent local site-to-content planning workflow.",
    input: {
      ...input,
      planLength,
    },
    siteContext: shrinkSiteContextForPrompt(siteContext),
  }),
  };
};

const antiAiPromptLines = [
  `Avoid fatigue words: ${FATIGUE_WORDS.slice(0, 12).join(", ")}.`,
  `Avoid patterns: ${FORBIDDEN_PATTERNS.map((entry) => entry.label).join("; ")}.`,
  "Write like a human editor: vary sentence length, use concrete nouns, no hollow summaries.",
];

export const buildDraftPlanPrompt = (input, calendarItem, siteContext) => {
  const template = resolveDraftTemplate(calendarItem);
  return {
    instructions: [
      "You plan a review-ready search-informed content draft. Return only strict JSON, no markdown.",
      "Use siteContext page titles and meta only — do not invent facts.",
      "Schema:",
      "{ angle, readerProblem, mustCover[3-5], mustAvoid[3-6], sectionOutline[3-6]{ id, purpose, transitionFrom, evidenceUrls[] }, urlStrategy{ strategy, targetUrl, reason }, voiceNotes }",
      `Template target: ${template.label} (${template.id}).`,
      `calendarItem.placement: ${calendarItem.placement || "blog"}. format: ${calendarItem.format || "guide"}.`,
      "mustCover items must be grounded in real site pages when possible.",
      "mustAvoid must include SEO-tool language and AI clichés.",
      "sectionOutline must define a logical narrative arc with clear transitions.",
      "urlStrategy.strategy is refresh or net-new; targetUrl must be on the same domain.",
      "Use English output.",
    ].join("\n"),
    message: JSON.stringify({
      task: "Plan draft intent for a calendar topic.",
      input,
      calendarItem,
      selectedTemplate: { id: template.id, label: template.label },
      siteContext: compactSiteContextForPlan(siteContext),
    }),
  };
};

export const buildDraftWritePrompt = (composedContext) => {
  const { input, calendarItem, template, intent, ruleStack, urlStrategy } = composedContext;
  return {
    instructions: [
      "You write one review-ready search-informed draft from a pre-planned intent and composed context.",
      ...sharedInstructions,
      ...antiAiPromptLines,
      composedContext.templateInstructions || getTemplatePromptInstructions(resolveDraftTemplate(calendarItem)),
      "Follow intent.sectionOutline order strictly. Each section or block must fulfill its purpose and transitionFrom.",
      "Cover every intent.mustCover point at least once in the body.",
      "Never use phrases listed in intent.mustAvoid or ruleStack.antiAiRules.",
      `Use placementUrl: ${urlStrategy?.targetUrl || ""} (strategy: ${urlStrategy?.strategy || "net-new"}).`,
      "qaChecks must include template match, template structure, URL strategy, schema fit, site grounding, evidence grounding, and product copy.",
      "Draft copy must describe the customer's product and reader problem. Never describe SEO tooling.",
      "schemaSuggestion.type must be one of: Article, FAQPage, HowTo, WebPage, SoftwareApplication.",
      "visualPlan.recommended must be one of: website screenshot, product screenshot, mermaid diagram, svg diagram, or generated png.",
      "Use English output.",
    ].join("\n"),
    message: JSON.stringify({
      task: "Write draft from composed context.",
      input,
      calendarItem,
      existingTitles: composedContext.existingTitles || [],
      intent,
      ruleStack,
      urlStrategy,
      pages: composedContext.pages || [],
      siteSummary: composedContext.siteSummary || {},
      template,
    }),
  };
};

export const buildDraftRevisePrompt = (draft, auditResult, composedContext) => {
  const mode = auditResult.reviseMode || "spot-fix";
  return {
    instructions: [
      "You revise an existing search-informed content draft based on structured audit feedback. Return only strict JSON draft object.",
      mode === "anti-detect"
        ? "Mode: anti-detect — rewrite AI-sounding phrases while preserving facts and structure."
        : "Mode: spot-fix — fix only the sections/blocks flagged in reviseHints; keep title, placementUrl, and evidenceRefs structure.",
      "Do not change title, placementUrl, templateId, or evidenceRefs URLs unless audit explicitly requires it.",
      ...antiAiPromptLines,
      "Preserve template structure (blocks or sections) and all required fields.",
      "Apply every reviseHint. Remove fatigue words and forbidden patterns.",
      "Use English output.",
    ].join("\n"),
    message: JSON.stringify({
      task: "Revise draft from audit feedback.",
      mode,
      reviseHints: auditResult.reviseHints || [],
      criticalFailures: (auditResult.criticalFailures || []).map((check) => check.detail),
      intent: composedContext.intent,
      ruleStack: composedContext.ruleStack,
      draft,
      pages: composedContext.pages || [],
    }),
  };
};

/** @deprecated Use buildDraftWritePrompt with composedContext via draft-pipeline */
export const buildDraftPrompt = (input, calendarItem, existingTitles, siteContext) => {
  const template = resolveDraftTemplate(calendarItem);
  return {
    instructions: [
      "You write one review-ready search-informed draft for a selected content plan topic.",
      ...sharedInstructions,
      ...antiAiPromptLines,
      "Use the supplied siteContext and business assumptions.",
      "Evidence must cite a real page URL from siteContext; never cite a generic source like homepage body without a URL.",
      getTemplatePromptInstructions(template),
      `calendarItem.placement: ${calendarItem.placement || "blog"}. calendarItem.format: ${calendarItem.format || "guide"}.`,
      "qaChecks must include explicit pass/warn/fail checks for template match, template structure, URL strategy, schema fit, site grounding, evidence grounding, and product copy.",
      "Draft copy must describe the customer's product and reader problem. Never describe SEO tooling, keyword queues, content machines, or this app's workflow.",
      "schemaSuggestion.type must be one of: Article, FAQPage, HowTo, WebPage, SoftwareApplication.",
      "placementUrl must be a concrete page target on the same domain: an existing siteContext page URL or a realistic new path such as /blog/article-slug.",
      "visualPlan.recommended must be one of: website screenshot, product screenshot, mermaid diagram, svg diagram, or generated png.",
      "If visualPlan recommends generated png, prompt must be a complete image generation prompt and referenceImages should include useful real site URLs when available.",
      "Use English output.",
    ].join("\n"),
    message: JSON.stringify({
      task: "Generate one new draft for the selected content plan item.",
      input,
      calendarItem,
      existingTitles,
      siteContext: shrinkSiteContextForPrompt(siteContext),
      selectedTemplate: { id: template.id, label: template.label },
    }),
  };
};
