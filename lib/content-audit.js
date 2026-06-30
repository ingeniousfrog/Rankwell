import { resolvePrimaryGroundingPage } from "./site-grounding.js";

const META_TOOL_PATTERNS = [
  /\bkeyword queue\b/i,
  /\bcontent (machine|operating system|workflow)\b/i,
  /\bturning seo into\b/i,
  /\bseo into a second full-time job\b/i,
  /\bsitecontext\b/i,
  /\blocal fallback\b/i,
  /\breview-ready qa\b/i,
  /\bcontent gaps?\b/i,
  /\bbuyer-intent topics?\b/i,
  /\bmeasurable conversion path\b/i,
  /\branked by commercial value\b/i,
  /\bstart with the website, not a blank prompt\b/i,
  /\bextract the product category, audience, pain points\b/i,
];

const INTERNAL_TITLE_PATTERNS = [
  /^why .+ struggle with /i,
  /^refresh angle:/i,
  /^buyer guide inspired by /i,
  /^comparison-led take on /i,
  /^practical workflow around /i,
  /^a lean workflow for turning /i,
  /^the hidden cost of manual /i,
  /^how to choose .+ without adding process drag/i,
  /: the practical version$/i,
  /\bprospective buyers evaluating\b/i,
  /\bfor prospective buyers\b/i,
];

const GENERIC_AUDIENCE_LABELS = [
  "prospective buyers",
  "prospective buyers evaluating",
  "teams evaluating",
  "users evaluating",
];

const GENERIC_CATEGORIES = new Set([
  "software product",
  "the product",
  "product",
  "website",
  "company",
]);

const GENERIC_KEYWORD_PATTERNS = [
  /^how to scale software product$/i,
  /^software product$/i,
  /^how to scale$/i,
];

const BROKEN_TITLE_PATTERNS = [
  /^how to software product$/i,
  /^how to the product$/i,
  /^how to [a-z]+ product$/i,
  /^best software product options/i,
];

export const isGenericCategory = (category) => GENERIC_CATEGORIES.has(String(category || "").trim().toLowerCase());

export const isGenericFallbackKeyword = (keyword) => {
  const text = String(keyword || "").trim().toLowerCase();
  if (GENERIC_KEYWORD_PATTERNS.some((pattern) => pattern.test(text))) return true;
  if (/^how to scale /.test(text)) {
    const tail = text.replace(/^how to scale /, "");
    return isGenericCategory(tail);
  }
  return false;
};

export const isBrokenAudienceTitle = (title) => BROKEN_TITLE_PATTERNS.some((pattern) => pattern.test(String(title || "").trim()));

const qa = (label, status, detail) => ({ label, status, detail });

const collectDraftText = (draft) => {
  const chunks = [draft.title, draft.meta, draft.cta];
  for (const section of draft.sections || []) {
    chunks.push(section.heading, section.body);
  }
  for (const block of draft.blocks || []) {
    chunks.push(block.heading, block.subheading, block.body, block.buttonText);
    for (const item of block.items || []) {
      chunks.push(item.title, item.body, item.summary, item.question, item.answer, item.label);
    }
  }
  for (const item of draft.faq || []) chunks.push(item);
  return chunks.filter(Boolean).join("\n");
};

const countGroundedEvidence = (draft, siteContext) => {
  const siteUrls = new Set((siteContext?.pages || []).map((page) => page.url).filter(Boolean));
  const refs = Array.isArray(draft.evidenceRefs) ? draft.evidenceRefs : [];
  const grounded = refs.filter((ref) => ref.url && siteUrls.has(ref.url));
  const localOnly = refs.filter((ref) => /local assumptions|initial local fallback/i.test(`${ref.source} ${ref.usedFor}`));
  return { total: refs.length, grounded: grounded.length, localOnly: localOnly.length };
};

export const resolveProductLabel = (inputs = {}, siteContext = null) => {
  const category = String(inputs.category || "").trim();
  if (category && !isGenericCategory(category)) return category;

  const home = resolvePrimaryGroundingPage(siteContext);
  const blurb = `${home?.title || ""} ${home?.metaDescription || ""} ${home?.pageText || ""}`;
  const domain = String(inputs.domain || "").toLowerCase();

  if (/(lipsync|synclip|talking head|avatar)/i.test(`${domain} ${blurb}`)) return "AI lipsync video generator";
  if (/(video|creator|clip)/i.test(`${domain} ${blurb}`)) return "AI video creation platform";
  if (/(seo|content|marketing)/i.test(`${domain} ${blurb}`)) return "search content planning platform";

  const brand = domain.split(".")[0] || "product";
  return `${brand} platform`;
};

export const detectMetaToolLanguage = (text) =>
  META_TOOL_PATTERNS.filter((pattern) => pattern.test(text)).map((pattern) => pattern.source);

export const isInternalCalendarTitle = (title) => INTERNAL_TITLE_PATTERNS.some((pattern) => pattern.test(String(title || "").trim()));

export const scoreAudienceTitle = (title, inputs = {}) => {
  const text = String(title || "").trim();
  if (!text) return { ok: false, reason: "Title is empty." };
  if (isBrokenAudienceTitle(text)) return { ok: false, reason: "Title is grammatically broken or too generic to publish." };
  if (isInternalCalendarTitle(text)) return { ok: false, reason: "Title reads like an internal search brief, not a publishable headline." };
  if (GENERIC_AUDIENCE_LABELS.some((label) => text.toLowerCase().includes(label))) {
    return { ok: false, reason: "Title uses a generic audience label instead of speaking to the reader directly." };
  }
  if (/^(why|how) (prospective buyers|founders|teams) /i.test(text)) {
    return { ok: false, reason: "Title frames the audience in third person instead of addressing the reader." };
  }
  if (text.length > 110) return { ok: false, reason: "Title is too long for a clickable headline." };
  if (text.split(/\s+/).length < 4) return { ok: false, reason: "Title is too short to communicate a clear reader benefit." };
  const category = String(inputs.category || "").toLowerCase();
  if (category && category !== "software product" && !text.toLowerCase().includes(category.split(" ")[0])) {
    const keywordRoot = category.split(/\s+/).slice(0, 2).join(" ");
    if (keywordRoot.length > 4 && !text.toLowerCase().includes(keywordRoot.split(" ")[0])) {
      return { ok: true, reason: "Title is audience-facing, but could tie more clearly to the product category." };
    }
  }
  return { ok: true, reason: "Title reads like a publishable, audience-facing headline." };
};

export const buildAudienceTitle = (calendarSeed, inputs) => {
  const keyword = String(calendarSeed.keyword || "").trim();
  const intent = calendarSeed.intent || "Problem";
  const format = calendarSeed.format || "guide";
  const product = resolveProductLabel(inputs);
  const audience = String(inputs.audience || "teams")
    .replace(/prospective buyers evaluating.*$/i, "buyers")
    .replace(/prospective buyers/i, "buyers")
    .trim();
  const shortProduct = product.length > 36 ? inputs.domain?.split(".")[0] || "this tool" : product;
  let shortKeyword = keyword
    .replace(/^(how to scale|how to|best alternative to|automated workflow for|software for|what is|improve)\s+/i, "")
    .trim();
  if (!shortKeyword || isGenericCategory(shortKeyword) || isGenericFallbackKeyword(keyword)) {
    shortKeyword = shortProduct;
  }

  if (intent === "Comparison" || format === "comparison") {
    return `Best ${shortKeyword || shortProduct} options for ${audience}`;
  }
  if (intent === "Education" || format === "explainer") {
    return `What is ${shortKeyword || shortProduct}? A guide for ${audience}`;
  }
  if (intent === "Buyer" || format === "buying guide") {
    return `How to choose ${shortKeyword || shortProduct} without overbuying`;
  }
  if (format === "playbook" || intent === "Use case") {
    return `A practical ${shortKeyword || shortProduct} workflow for ${audience}`;
  }
  if (calendarSeed.pageTitle) {
    return `How to update ${calendarSeed.pageTitle}`;
  }
  return `How to ${shortKeyword || `get started with ${shortProduct}`}`;
};

export const auditContentGrounding = (draft, siteContext = null, inputs = {}) => {
  const checks = [];
  const text = collectDraftText(draft);
  const evidence = countGroundedEvidence(draft, siteContext);
  const metaHits = detectMetaToolLanguage(text);

  if (!siteContext?.ok) {
    checks.push(
      qa(
        "Site grounding",
        "fail",
        "Draft was generated without a successful website crawl. Re-analyze the site before export.",
      ),
    );
  } else {
    checks.push(qa("Site grounding", "pass", "Website crawl succeeded before draft generation."));
  }

  if (evidence.grounded < 2) {
    checks.push(
      qa(
        "Evidence grounding",
        siteContext?.ok ? "fail" : "warn",
        `Only ${evidence.grounded} website reference(s) cite crawled pages. Need at least 2 real page URLs from siteContext.`,
      ),
    );
  } else {
    checks.push(qa("Evidence grounding", "pass", `${evidence.grounded} website references cite crawled pages.`));
  }

  if (evidence.localOnly > 0) {
    checks.push(
      qa(
        "Fallback evidence",
        "fail",
        "Draft still relies on local fallback assumptions instead of crawled website evidence.",
      ),
    );
  }

  if (metaHits.length > 0) {
    checks.push(
      qa(
        "Product copy",
        "fail",
        `Draft contains tool/meta planning language instead of product copy (${metaHits.slice(0, 2).join(", ")}).`,
      ),
    );
  } else {
    checks.push(qa("Product copy", "pass", "Draft copy stays focused on the product and reader problem."));
  }

  const category = String(inputs.category || "").toLowerCase();
  if (isGenericCategory(category) && siteContext?.ok) {
    checks.push(
      qa(
        "Category specificity",
        "warn",
        "Product category is still generic. Override AI assumptions with a specific category from the website.",
      ),
    );
  }

  return {
    checks,
    hasFailures: checks.some((check) => check.status === "fail"),
  };
};

export const auditCalendarItem = (item, inputs = {}, siteContext = null) => {
  const checks = [];
  const titleScore = scoreAudienceTitle(item.title, inputs);
  if (!titleScore.ok) {
    checks.push(qa("Audience title", "fail", titleScore.reason));
  } else if (titleScore.reason.includes("could tie more clearly")) {
    checks.push(qa("Audience title", "warn", titleScore.reason));
  } else {
    checks.push(qa("Audience title", "pass", titleScore.reason));
  }

  if (!item.placement) {
    checks.push(qa("Publish target", "warn", "Calendar item is missing a placement target."));
  } else {
    checks.push(qa("Publish target", "pass", `Planned for ${item.placement}.`));
  }

  if (!item.keyword || item.keyword.length < 4) {
    checks.push(qa("Keyword fit", "fail", "Calendar item is missing a usable target keyword."));
  } else if (isGenericFallbackKeyword(item.keyword) || isGenericCategory(item.keyword)) {
    checks.push(qa("Keyword fit", "fail", "Keyword is a generic fallback phrase, not a real search topic for this site."));
  } else {
    checks.push(qa("Keyword fit", "pass", "Keyword is specific enough to guide the draft."));
  }

  if (siteContext?.ok && item.placement && /product|landing/i.test(item.placement)) {
    const overlapPages = (siteContext.pages || []).filter((page) =>
      /product|generator|pricing|feature/i.test(`${page.url} ${page.title}`),
    );
    if (overlapPages.length > 0 && !item.placementUrl) {
      checks.push(qa("Publish target", "warn", "Product-page item should name a concrete publish URL or refresh target."));
    }
  }

  return {
    checks,
    hasFailures: checks.some((check) => check.status === "fail"),
    suggestedTitle: !titleScore.ok ? buildAudienceTitle(item, inputs) : "",
  };
};

export const auditCalendar = (calendar = [], inputs = {}, siteContext = null) => {
  const items = calendar.map((item) => {
    const audit = auditCalendarItem(item, inputs, siteContext);
    return {
      ...item,
      qaChecks: audit.checks,
      suggestedTitle: audit.suggestedTitle,
      hasQaFailures: audit.hasFailures,
    };
  });
  const failures = items.filter((item) => item.hasQaFailures).length;
  const warnings = items.reduce(
    (count, item) => count + (item.qaChecks || []).filter((check) => check.status === "warn").length,
    0,
  );
  return {
    items,
    summary: {
      total: items.length,
      failures,
      warnings,
      hasFailures: failures > 0,
    },
  };
};
