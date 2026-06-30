import { auditContentGrounding } from "./content-audit.js";

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
]);

export const DRAFT_TEMPLATE_CATALOG = {
  productPage: {
    id: "productPage",
    label: "Product landing page",
    placements: ["product page", "product", "landing page", "landing"],
    formats: ["landing", "product"],
    schemaTypes: ["WebPage", "SoftwareApplication", "FAQPage"],
    requiredBlockTypes: ["hero", "steps", "features", "faq", "cta"],
    promptSchema: [
      "templateId must be productPage.",
      "Use blocks (not generic article sections) in this order:",
      "blocks: [",
      "  { type: hero, heading, subheading, body, primaryCta, secondaryCta },",
      "  { type: steps, items[3]{ step, title, body } },",
      "  { type: features, items[3-5]{ title, body } },",
      "  { type: useCases, items[2-4]{ title, body } },",
      "  { type: faq, items[4-6]{ question, answer } },",
      "  { type: cta, heading, body, buttonText }",
      "]",
      "Hero must state the keyword value proposition. Steps must describe the real product workflow.",
      "Prefer refreshing an existing product URL from siteContext over inventing a cannibalizing new path.",
      "sections may be empty []. Mirror FAQ into top-level faq[3-6] as question — answer strings.",
    ].join("\n"),
  },
  blogArticle: {
    id: "blogArticle",
    label: "Blog article",
    placements: ["blog", "cms", "article", "cms collection"],
    formats: ["guide", "explainer", "playbook", "checklist", "article"],
    schemaTypes: ["Article", "HowTo"],
    requiredBlockTypes: [],
    promptSchema: [
      "templateId must be blogArticle.",
      "Use editorial sections for long-form content:",
      "sections[4-6]{ heading, body } with intro, workflow, product fit, and publish guidance.",
      "blocks may be empty [].",
      "faq[3-5] and cta are required.",
    ].join("\n"),
  },
  comparisonPage: {
    id: "comparisonPage",
    label: "Comparison page",
    placements: ["comparison page", "comparison", "alternative"],
    formats: ["comparison", "buying guide"],
    schemaTypes: ["FAQPage", "Article"],
    requiredBlockTypes: ["intro", "comparison", "verdict", "faq", "cta"],
    promptSchema: [
      "templateId must be comparisonPage.",
      "blocks: [",
      "  { type: intro, heading, body },",
      "  { type: comparison, items[3-5]{ label, summary } },",
      "  { type: verdict, heading, body },",
      "  { type: faq, items[3-5]{ question, answer } },",
      "  { type: cta, heading, body, buttonText }",
      "]",
      "sections may be empty [].",
    ].join("\n"),
  },
  docsGuide: {
    id: "docsGuide",
    label: "Docs / how-to guide",
    placements: ["docs", "documentation", "template gallery"],
    formats: ["guide", "playbook", "howto"],
    schemaTypes: ["HowTo", "Article"],
    requiredBlockTypes: ["intro", "steps", "faq", "cta"],
    promptSchema: [
      "templateId must be docsGuide.",
      "blocks: [",
      "  { type: intro, heading, body },",
      "  { type: steps, items[3-6]{ step, title, body } },",
      "  { type: faq, items[3-4]{ question, answer } },",
      "  { type: cta, heading, body, buttonText }",
      "]",
      "sections may be empty [].",
    ].join("\n"),
  },
};

const tokenize = (text) =>
  String(text || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));

const RELATED_TOKENS = {
  lipsync: ["talking", "head", "avatar", "speech", "mouth"],
  talking: ["lipsync", "avatar", "head", "speech"],
  head: ["talking", "avatar", "lipsync", "speech"],
  avatar: ["talking", "head", "lipsync", "portrait"],
  generator: ["maker", "creator", "tool"],
  video: ["clip", "creator"],
};

const relatedTokensFor = (token) =>
  Object.prototype.hasOwnProperty.call(RELATED_TOKENS, token) && Array.isArray(RELATED_TOKENS[token])
    ? RELATED_TOKENS[token]
    : [];

const expandTokens = (tokens) => {
  const expanded = new Set(tokens);
  for (const token of tokens) {
    for (const related of relatedTokensFor(token)) {
      expanded.add(related);
    }
  }
  return [...expanded];
};

const placementText = (calendarItem = {}, draft = {}) =>
  `${calendarItem.placement || ""} ${draft.placement || ""}`.toLowerCase();

export const resolveDraftTemplate = (calendarItem = {}, draft = {}) => {
  const placement = placementText(calendarItem, draft);
  const format = String(calendarItem.format || draft.format || "").toLowerCase();
  const intent = String(calendarItem.intent || draft.intent || "").toLowerCase();

  if (placement.includes("comparison") || format === "comparison" || intent === "comparison") {
    return DRAFT_TEMPLATE_CATALOG.comparisonPage;
  }
  if (placement.includes("doc") || placement.includes("template")) {
    return DRAFT_TEMPLATE_CATALOG.docsGuide;
  }
  if (
    placement.includes("product") ||
    placement.includes("landing") ||
    format === "landing" ||
    format === "product" ||
    intent === "buyer"
  ) {
    return DRAFT_TEMPLATE_CATALOG.productPage;
  }
  if (placement.includes("blog") || placement.includes("cms") || placement.includes("article")) {
    return DRAFT_TEMPLATE_CATALOG.blogArticle;
  }
  if (format === "guide" || format === "playbook" || intent === "problem" || intent === "use case") {
    return DRAFT_TEMPLATE_CATALOG.blogArticle;
  }
  return DRAFT_TEMPLATE_CATALOG.blogArticle;
};

export const getTemplatePromptInstructions = (template) =>
  [
    `Selected content template: ${template.label} (${template.id}).`,
    "Resolve the template from calendarItem.placement and format before writing.",
    "The draft must follow the selected template structure exactly.",
    template.promptSchema,
    "Shared draft fields: { templateId, templateLabel, title, meta, placement, placementUrl, schemaSuggestion{ type, reason }, visualPlan, evidenceRefs[3], qaChecks[5], blocks, sections, faq, cta }.",
  ].join("\n");

const blockTypes = (draft) =>
  (Array.isArray(draft.blocks) ? draft.blocks : []).map((block) => String(block.type || "").toLowerCase());

const hasSections = (draft) => Array.isArray(draft.sections) && draft.sections.length > 0;

export const findIntentOverlapPage = (keyword, siteContext) => {
  const keywordTokens = expandTokens(tokenize(keyword));
  if (keywordTokens.length === 0) return null;

  let best = null;
  let bestScore = 0;
  for (const page of siteContext?.pages || []) {
    let pathname = "";
    try {
      pathname = new URL(page.url).pathname.replace(/[-_/]+/g, " ");
    } catch {
      pathname = "";
    }
    const pageTokens = new Set(expandTokens(tokenize(`${page.url} ${pathname} ${page.title || ""} ${page.h1 || ""}`)));
    const overlap = keywordTokens.filter((token) => pageTokens.has(token)).length;
    const score = overlap / keywordTokens.length;
    if (score > bestScore) {
      bestScore = score;
      best = page;
    }
  }

  if (!best || bestScore < 0.34) return null;
  return { page: best, score: bestScore };
};

export const suggestPlacementUrl = (calendarItem, siteContext, inputs) => {
  const overlap = findIntentOverlapPage(calendarItem.keyword, siteContext);
  const template = resolveDraftTemplate(calendarItem);
  if (overlap && ["productPage", "comparisonPage"].includes(template.id)) {
    return {
      url: overlap.page.url,
      strategy: "refresh",
      reason: `Existing page "${overlap.page.title || overlap.page.h1 || overlap.page.url}" already overlaps this keyword intent.`,
      overlapScore: overlap.score,
    };
  }

  const slug = String(calendarItem.keyword || "topic")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  const prefix =
    template.id === "productPage" ? "" : template.id === "comparisonPage" ? "compare/" : template.id === "docsGuide" ? "docs/" : "blog/";
  const origin = siteContext?.startUrl || inputs?.url || "";
  try {
    const base = new URL(origin);
    return {
      url: `${base.origin}/${prefix}${slug}`,
      strategy: "net-new",
      reason: "No strong overlap page found; proposing a new publish path.",
      overlapScore: overlap?.score || 0,
    };
  } catch {
    return {
      url: inputs?.url || "",
      strategy: "unknown",
      reason: "Could not infer a publish URL.",
      overlapScore: 0,
    };
  }
};

const qa = (label, status, detail) => ({ label, status, detail });

export const auditDraft = (draft, calendarItem = {}, siteContext = null, inputs = {}) => {
  const expectedTemplate = resolveDraftTemplate(calendarItem, draft);
  const actualTemplateId = draft.templateId || expectedTemplate.id;
  const checks = [];
  const types = blockTypes(draft);

  if (actualTemplateId !== expectedTemplate.id) {
    checks.push(
      qa(
        "Template match",
        "fail",
        `Expected ${expectedTemplate.label} (${expectedTemplate.id}) but draft uses ${actualTemplateId || "no template"}.`,
      ),
    );
  } else {
    checks.push(qa("Template match", "pass", `Draft follows ${expectedTemplate.label} template.`));
  }

  if (expectedTemplate.requiredBlockTypes.length > 0) {
    const missing = expectedTemplate.requiredBlockTypes.filter((type) => !types.includes(type));
    if (missing.length > 0) {
      checks.push(
        qa(
          "Template structure",
          "fail",
          `Missing required blocks for ${expectedTemplate.label}: ${missing.join(", ")}.`,
        ),
      );
    } else {
      checks.push(qa("Template structure", "pass", `Required blocks present: ${expectedTemplate.requiredBlockTypes.join(", ")}.`));
    }
  } else if (expectedTemplate.id === "blogArticle") {
    if (!hasSections(draft) || draft.sections.length < 3) {
      checks.push(qa("Template structure", "fail", "Blog article template needs at least 3 sections."));
    } else if (types.length > 0 && types.some((type) => ["hero", "steps", "features"].includes(type))) {
      checks.push(
        qa(
          "Template structure",
          "warn",
          "Blog article draft mixes landing-page blocks with article sections.",
        ),
      );
    } else {
      checks.push(qa("Template structure", "pass", "Blog article has the expected section-based structure."));
    }
  }

  const placementUrl = draft.placementUrl || "";
  const overlap = findIntentOverlapPage(calendarItem.keyword, siteContext);
  if (overlap && placementUrl && !placementUrl.includes(new URL(overlap.page.url).pathname)) {
    const isNewPath = !siteContext?.pages?.some((page) => page.url === placementUrl);
    if (isNewPath) {
      checks.push(
        qa(
          "URL strategy",
          "fail",
          `Proposed URL may cannibalize ${overlap.page.url}. Prefer refreshing the existing page.`,
        ),
      );
    } else {
      checks.push(qa("URL strategy", "pass", "Publish URL aligns with an existing site page."));
    }
  } else if (placementUrl) {
    checks.push(qa("URL strategy", "pass", "No strong keyword overlap conflict detected for the publish URL."));
  } else {
    checks.push(qa("URL strategy", "warn", "Publish URL is missing."));
  }

  const schemaType = draft.schemaSuggestion?.type || "";
  if (schemaType && !expectedTemplate.schemaTypes.includes(schemaType)) {
    checks.push(
      qa(
        "Schema fit",
        "warn",
        `${schemaType} schema is unusual for ${expectedTemplate.label}. Expected one of: ${expectedTemplate.schemaTypes.join(", ")}.`,
      ),
    );
  } else if (schemaType) {
    checks.push(qa("Schema fit", "pass", `${schemaType} schema fits ${expectedTemplate.label}.`));
  } else {
    checks.push(qa("Schema fit", "warn", "Schema suggestion is missing."));
  }

  const suggestion = suggestPlacementUrl(calendarItem, siteContext, inputs);
  if (suggestion.strategy === "refresh" && placementUrl && placementUrl !== suggestion.url) {
    checks.push(
      qa(
        "Recommended URL",
        "warn",
        `${suggestion.reason} Suggested target: ${suggestion.url}`,
      ),
    );
  }

  const grounding = auditContentGrounding(draft, siteContext, inputs);
  const existingLabels = new Set(checks.map((check) => check.label));
  checks.push(...grounding.checks.filter((check) => !existingLabels.has(check.label)));

  return {
    template: expectedTemplate,
    checks,
    suggestedPlacement: suggestion,
    hasFailures: checks.some((check) => check.status === "fail"),
  };
};

export const buildFallbackBlocks = (template, calendarItem, inputs) => {
  const keyword = calendarItem.keyword || inputs.category || "workflow";
  if (template.id === "productPage") {
    return [
      {
        type: "hero",
        heading: calendarItem.title || keyword,
        subheading: `A practical ${inputs.category || "product"} workflow for ${inputs.audience || "teams"}.`,
        body: `Turn ${keyword} into a clear product story with a direct CTA and workflow-focused copy.`,
        primaryCta: `Start free`,
        secondaryCta: `View pricing`,
      },
      {
        type: "steps",
        items: [
          { step: 1, title: "Add source inputs", body: `Start with the portrait, script, or audio needed for ${keyword}.` },
          { step: 2, title: "Generate the asset", body: "Use the product workflow to produce the lipsync or talking-head output." },
          { step: 3, title: "Review and export", body: `Publish the final clip with the CTA that supports ${inputs.goal || "conversion"}.` },
        ],
      },
      {
        type: "features",
        items: [
          { title: "Workflow in one place", body: "Keep scripting, voice, and export steps inside one guided flow." },
          { title: "Faster iteration", body: "Regenerate drafts and sections without rebuilding the page structure." },
          { title: "Evidence-backed copy", body: "Anchor claims to real pages from the crawled site." },
        ],
      },
      {
        type: "useCases",
        items: [
          { title: "Marketing", body: "Explain the product with a landing-page structure instead of a generic article." },
          { title: "Education", body: "Use step blocks for onboarding and tutorial-style pages." },
        ],
      },
      {
        type: "faq",
        items: [
          { question: `What is ${keyword}?`, answer: "It is a product-led page structured for commercial search intent." },
          { question: "When should I refresh an existing page?", answer: "When siteContext already has a overlapping product URL." },
        ],
      },
      {
        type: "cta",
        heading: "Publish with the right template",
        body: `Create the first ${keyword} page using the ${template.label} structure.`,
        buttonText: inputs.goal ? `Help users ${inputs.goal}` : "Get started",
      },
    ];
  }

  if (template.id === "comparisonPage") {
    return [
      { type: "intro", heading: calendarItem.title, body: `Compare options for ${keyword} with buyer-intent structure.` },
      {
        type: "comparison",
        items: [
          { label: inputs.domain || "Your product", summary: "Best fit when workflow speed and site-grounded copy matter." },
          { label: "Manual content process", summary: "Slower and harder to keep aligned with existing pages." },
          { label: "Generic AI article", summary: "Often misses placement-specific structure and URL strategy." },
        ],
      },
      { type: "verdict", heading: "Best choice", body: `Use a comparison template when the keyword intent is evaluation-led.` },
      {
        type: "faq",
        items: [{ question: `How is this different from ${keyword}?`, answer: "It uses a comparison page template instead of article sections." }],
      },
      { type: "cta", heading: "Choose the right page type", body: "Publish with comparison blocks and a clear verdict.", buttonText: "Compare plans" },
    ];
  }

  if (template.id === "docsGuide") {
    return [
      { type: "intro", heading: calendarItem.title, body: `How to execute ${keyword} with a docs-style guide.` },
      {
        type: "steps",
        items: [
          { step: 1, title: "Prepare inputs", body: "Collect the site pages and assumptions needed for the draft." },
          { step: 2, title: "Generate", body: "Create the guide using the docs template." },
          { step: 3, title: "Review QA", body: "Confirm template structure and publish URL before shipping." },
        ],
      },
      {
        type: "faq",
        items: [{ question: "When should I use docsGuide?", answer: "Use it for onboarding, playbooks, and how-to pages." }],
      },
      { type: "cta", heading: "Continue in docs", body: "Publish this guide in the docs collection.", buttonText: "Open docs" },
    ];
  }

  return [];
};

export const faqFromBlocks = (blocks = []) => {
  const faqBlock = blocks.find((block) => block.type === "faq");
  if (!faqBlock?.items) return [];
  return faqBlock.items.map((item) => `${item.question} — ${item.answer}`);
};

export const ctaFromBlocks = (blocks = []) => {
  const ctaBlock = blocks.find((block) => block.type === "cta");
  if (!ctaBlock) return "";
  return [ctaBlock.heading, ctaBlock.body, ctaBlock.buttonText].filter(Boolean).join(" ");
};
