import { checklistItems } from "./checklist-taxonomy.js";
import { buildRefreshCandidates } from "../lib/refresh-candidates.js";
import { composeDraftContext } from "../lib/draft-compose.js";
import { buildFallbackIntent } from "../lib/draft-intent.js";
import { auditDraftFull } from "../lib/draft-quality-audit.js";
import {
  buildFallbackBlocks,
  ctaFromBlocks,
  faqFromBlocks,
  resolveDraftTemplate,
  suggestPlacementUrl,
} from "../lib/draft-templates.js";
import { auditCalendar, buildAudienceTitle, isGenericCategory, resolveProductLabel } from "../lib/content-audit.js";
import { normalizePlanLength } from "../lib/plan-length.js";
import { resolvePrimaryGroundingPage } from "../lib/site-grounding.js";

export const voiceRules = {
  sharp: {
    label: "Operator brief",
    line: "compact, decisive, proof-seeking, and focused on the next concrete action",
  },
  editorial: {
    label: "Field-guide narrative",
    line: "measured, example-led, strategic, and built around the reader's working context",
  },
  technical: {
    label: "Evidence memo",
    line: "specific, structured, source-aware, and careful with unsupported claims",
  },
  friendly: {
    label: "Plain-language coach",
    line: "clear, calm, low-jargon, and focused on practical reader progress",
  },
  founder: {
    label: "Founder note",
    line: "direct, opinionated, lean, and honest about tradeoffs",
  },
};

export { checklistItems };

const intentTemplates = [
  { intent: "Problem", prefix: "how to scale", format: "guide" },
  { intent: "Comparison", prefix: "best alternative to", format: "comparison" },
  { intent: "Use case", prefix: "automated workflow for", format: "playbook" },
  { intent: "Buyer", prefix: "software for", format: "buying guide" },
  { intent: "Education", prefix: "what is", format: "explainer" },
  { intent: "Optimization", prefix: "improve", format: "checklist" },
];

export const parseDomain = (rawUrl) => {
  try {
    const url = new URL(rawUrl);
    return url.hostname.replace(/^www\./, "");
  } catch {
    return String(rawUrl || "")
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split("/")[0];
  }
};

const findPageUrl = (pages, matcher) => pages.find((page) => matcher(page))?.url || "";

export const inferPlacementUrl = (placement, siteContext, inputs, calendarItem = null) => {
  if (calendarItem?.placementUrl) return calendarItem.placementUrl;

  const pages = siteContext?.pages || [];
  const needle = String(placement || calendarItem?.placement || "").toLowerCase();
  const byType = (type) => findPageUrl(pages, (page) => page.pageType === type);
  const byUrl = (pattern) => findPageUrl(pages, (page) => pattern.test(page.url));

  if (needle.includes("blog")) {
    return byType("blog") || byUrl(/\/blog\b/i) || byUrl(/\/posts?\//i);
  }
  if (needle.includes("doc")) {
    return byType("docs") || byUrl(/\/docs?\b/i);
  }
  if (needle.includes("pricing")) {
    return byType("pricing") || byUrl(/pricing/i);
  }
  if (needle.includes("comparison")) {
    return byType("comparison") || byUrl(/compare|versus|vs\b/i);
  }
  if (needle.includes("product")) {
    return byType("product") || byUrl(/product|features/i);
  }
  if (needle.includes("template")) {
    return byUrl(/template|gallery/i);
  }
  if (needle.includes("landing")) {
    return resolvePrimaryGroundingPage(siteContext)?.url || byType("home") || inputs?.url || siteContext?.startUrl || "";
  }

  return byType("blog") || byType("home") || inputs?.url || siteContext?.startUrl || "";
};

const titleCase = (text) =>
  text
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");

const inferInputsFromSiteContext = (inputs, siteContext) => {
  const pages = siteContext?.pages || [];
  const home = resolvePrimaryGroundingPage(siteContext);
  const pricing = pages.find((page) => page.pageType === "pricing");
  const title = home?.title || home?.h1 || inputs.domain;
  const blurb = home?.metaDescription || home?.pageText?.slice(0, 220) || "";
  const titleLead = title.split(/[|–\-:]/)[0]?.trim() || inputs.domain;

  let category = inputs.category;
  if (!category || isGenericCategory(category)) {
    if (/(video|clip|creator|ai|lipsync|talking head|avatar)/i.test(`${title} ${blurb}`)) category = "AI video creation platform";
    else if (/(seo|content|marketing)/i.test(`${title} ${blurb}`)) category = "search and content planning software";
    else category = titleLead && !isGenericCategory(titleLead) ? titleLead : resolveProductLabel(inputs, siteContext);
  }

  let audience = inputs.audience;
  if (!audience) {
    if (/(creator|video|youtube|tiktok)/i.test(`${title} ${blurb}`)) audience = "creators and marketers";
    else if (/(founder|startup|team)/i.test(`${title} ${blurb}`)) audience = "founders and content teams";
    else audience = "marketing teams";
  }

  const goal = inputs.goal || (pricing ? "start a paid plan" : "start a free trial");
  const voice = inputs.voice && voiceRules[inputs.voice] ? inputs.voice : "sharp";

  return { ...inputs, category, audience, goal, voice };
};

const inferContentGap = (siteContext) => {
  const pageTypes = siteContext?.summary?.pageTypes || {};
  const gaps = [];
  if (!pageTypes.blog) gaps.push("audience problem explainers");
  if (!pageTypes.comparison) gaps.push("comparison and alternative pages");
  if (!pageTypes.docs) gaps.push("workflow guides and onboarding docs");
  if (!pageTypes.proof) gaps.push("case studies and proof-led explainers");
  if ((pageTypes.blog || 0) < 5) gaps.push("repeatable planning cadence");
  return gaps.length > 0 ? gaps.join(", ") : "Search-informed comparisons, workflow guides, proof-led explainers, and refresh targets.";
};

const inferPublishingRule = (siteContext) => {
  const pageCount = siteContext?.summary?.pageCount || 0;
  if (pageCount > 40) {
    return "Review high-intent pages weekly, prepare focused draft outlines, and check internal links before export.";
  }
  return "Prepare a focused batch of draft outlines, prioritize pages missing from the sitemap mix, and review winners after the first cycle.";
};

const buildKeywords = (inputs, siteContext = null) => {
  const productLabel = resolveProductLabel(inputs, siteContext).toLowerCase();
  return intentTemplates.map((template, index) => ({
    keyword: `${template.prefix} ${productLabel}`.replace(/\s+/g, " ").trim(),
    intent: template.intent,
    format: template.format,
    commercialValue: Math.max(3, 5 - (index % 3)),
    difficulty: 2 + (index % 4),
    productFit: index === 1 ? 4 : 5,
    questionVariants: [
      `What is ${template.prefix} ${productLabel}?`,
      `How does ${productLabel} help ${inputs.audience}?`,
      `Why do ${inputs.audience} need ${template.prefix} ${productLabel}?`,
    ],
  }));
};

const buildCalendar = (keywords, inputs, siteContext = null) => {
  const planLength = normalizePlanLength(inputs.planLength);
  const contentPages = (siteContext?.pages || [])
    .filter((page) => ["blog", "product", "docs", "proof", "pricing", "page"].includes(page.pageType))
    .filter((page) => page.title || page.h1)
    .slice(0, planLength);

  if (contentPages.length >= 8) {
    return Array.from({ length: planLength }, (_, index) => {
      const page = contentPages[index % contentPages.length];
      const keyword = keywords[index % keywords.length];
      const pageTitle = page.h1 || page.title;
      const seed = {
        keyword: keyword.keyword,
        intent: keyword.intent,
        format: keyword.format,
        placement: page.pageType === "blog" ? "blog" : page.pageType || "landing page",
        pageTitle,
      };

      return {
        day: index + 1,
        title: buildAudienceTitle(seed, inputs),
        keyword: keyword.keyword,
        intent: keyword.intent,
        format: keyword.format,
        placement: seed.placement,
        placementUrl: page.url,
      };
    });
  }

  return Array.from({ length: planLength }, (_, index) => {
    const keyword = keywords[index % keywords.length];
    const seed = {
      keyword: keyword.keyword,
      intent: keyword.intent,
      format: keyword.format,
      placement: keyword.format === "comparison" ? "comparison page" : keyword.format === "guide" ? "blog" : "blog",
    };

    return {
      day: index + 1,
      title: buildAudienceTitle(seed, inputs),
      keyword: keyword.keyword,
      intent: keyword.intent,
      format: keyword.format,
      placement: seed.placement,
    };
  });
};

const inferSchemaSuggestion = (calendarItem, template) => {
  if (template.id === "productPage") {
    return { type: "WebPage", reason: "Product landing pages should use WebPage or SoftwareApplication schema with optional FAQ blocks." };
  }
  if (template.id === "comparisonPage") {
    return { type: "FAQPage", reason: "Comparison topics benefit from FAQ schema for rich results." };
  }
  if (template.id === "docsGuide" || calendarItem.format === "guide" || calendarItem.intent === "Problem") {
    return { type: "HowTo", reason: "Workflow guides map cleanly to HowTo structured data." };
  }
  return { type: "Article", reason: "Default article schema for editorial content." };
};

const buildBlogSections = (calendarItem, inputs, siteContext) => {
  const keyword = calendarItem.keyword || inputs.category;
  const home = resolvePrimaryGroundingPage(siteContext);
  const productPage =
    siteContext?.pages?.find((page) => /talking|lipsync|avatar|video/i.test(`${page.title} ${page.url}`)) || home;
  const proof = productPage?.metaDescription || productPage?.pageText?.slice(0, 180) || home?.metaDescription || home?.pageText?.slice(0, 180) || "";
  const productName = inputs.domain || "the product";

  return [
    {
      heading: `What readers want from "${keyword}"`,
      body: proof
        ? `${productName} helps ${inputs.audience} ${inputs.goal}. ${proof}`
        : `${inputs.audience} searching for "${keyword}" want a clear answer, a realistic workflow, and proof that ${productName} fits the job.`,
    },
    {
      heading: "The workflow that matters",
      body: `Show the exact steps: what to prepare, what the product automates, and what still needs a human review before export or sharing.`,
    },
    {
      heading: `How ${productName} fits this job`,
      body: `Connect the keyword to a real product capability from the website. Focus on the outcome for ${inputs.audience}, not on SEO process or content operations.`,
    },
    {
      heading: "What to do next",
      body: `End with one concrete next step that matches the reader stage: try the product, compare plans, or follow the guide to produce the first usable result.`,
    },
  ];
};

const buildSectionsFromIntent = (intent, calendarItem, inputs, siteContext) => {
  const product = resolveProductLabel(inputs, siteContext);
  const keyword = calendarItem.keyword || inputs.category || "topic";
  return (intent.sectionOutline || []).map((section) => ({
    heading: section.purpose || section.id,
    body: `${section.transitionFrom}. ${section.purpose} for ${keyword} using ${product} on ${inputs.domain}.`,
  }));
};

const buildDraft = (calendarItem, inputs, siteContext = null) => {
  const template = resolveDraftTemplate(calendarItem);
  const draftIntent = buildFallbackIntent(calendarItem, inputs, siteContext);
  const composedContext = composeDraftContext({
    input: inputs,
    calendarItem,
    siteContext,
    draftIntent,
    existingTitles: [],
  });
  const placementSuggestion = composedContext.placementSuggestion || suggestPlacementUrl(calendarItem, siteContext, inputs);
  const blocks = buildFallbackBlocks(template, calendarItem, inputs);
  const sections =
    template.id === "blogArticle"
      ? buildSectionsFromIntent(draftIntent, calendarItem, inputs, siteContext)
      : [];

  const draft = {
  title: calendarItem.title,
  meta: `${draftIntent.angle} ${draftIntent.readerProblem}`.slice(0, 160),
  templateId: template.id,
  templateLabel: template.label,
  placement: calendarItem.placement || template.label,
  placementUrl: placementSuggestion.url || inferPlacementUrl(calendarItem.placement, siteContext, inputs, calendarItem),
  placementStrategy: placementSuggestion.strategy,
  schemaSuggestion: inferSchemaSuggestion(calendarItem, template),
  draftRuntime: {
    intent: draftIntent,
    composedPageCount: composedContext.pages?.length || 0,
    pipelineStages: ["plan", "compose", "write"],
    reviseApplied: false,
    urlStrategy: composedContext.urlStrategy,
  },
  visualPlan: {
    recommended: template.id === "productPage" ? "product screenshot" : "mermaid diagram",
    reason:
      template.id === "productPage"
        ? "Product pages should show the real interface when siteContext has usable screenshots."
        : "This topic explains a repeatable workflow, so a process diagram helps readers scan the idea.",
    promptOrSpec:
      template.id === "productPage"
        ? "Use a real product screenshot from siteContext when available; otherwise describe the hero workflow clearly."
        : "flowchart LR; URL-->Context; Context-->Keywords; Keywords-->Draft; Draft-->Publish",
    referenceImages: [],
    altText: `${inputs.domain} ${template.label.toLowerCase()} draft visual.`,
  },
  blocks,
  evidenceRefs: siteContext?.pages?.length
    ? siteContext.pages.slice(0, 3).map((page) => ({
        url: page.url,
        pageTitle: page.title || page.h1 || page.url,
        source: "website crawl",
        quote: page.metaDescription || page.pageText?.slice(0, 160) || page.url,
        usedFor: `Grounding for "${calendarItem.keyword}".`,
      }))
    : [
        {
          url: inputs.url,
          pageTitle: inputs.domain,
          source: "local assumptions",
          quote: `${inputs.domain} / ${inputs.category}`,
          usedFor: "Initial local fallback draft context.",
        },
      ],
  qaChecks: [
    {
      label: "Grounding",
      status: siteContext?.ok ? "warn" : "warn",
      detail: siteContext?.ok
        ? "Local fallback draft uses crawled site pages; review before export."
        : "Local fallback draft has not checked live website evidence.",
    },
  ],
  sections,
  faq: template.id === "blogArticle"
    ? [
        `How do I get started with ${calendarItem.keyword} on ${inputs.domain}?`,
        `What inputs do I need before creating the first result?`,
        `Which plan fits ${inputs.audience} best?`,
      ]
    : faqFromBlocks(blocks),
  cta:
    template.id === "blogArticle"
      ? `Try ${inputs.domain} free and ${inputs.goal}.`
      : ctaFromBlocks(blocks),
};

  const audit = auditDraftFull(draft, calendarItem, siteContext, inputs, draftIntent);
  draft.qaChecks = [...draft.qaChecks, ...audit.checks];
  return draft;
};

export { buildDraft };

export const createFallbackWorkflow = (inputs, siteContext = null) => {
  const resolvedInputs = {
    ...inferInputsFromSiteContext(inputs, siteContext),
    planLength: normalizePlanLength(inputs?.planLength),
  };
  const keywords = buildKeywords(resolvedInputs, siteContext);
  const rawCalendar = buildCalendar(keywords, resolvedInputs, siteContext);
  const calendarAudit = auditCalendar(rawCalendar, resolvedInputs, siteContext);
  const calendar = calendarAudit.items;
  const draftCandidates = calendar.filter((item) => !item.hasQaFailures);
  const drafts =
    resolvedInputs.includeDraft && siteContext?.ok && draftCandidates.length > 0
      ? draftCandidates.slice(0, 1).map((item) => buildDraft(item, resolvedInputs, siteContext))
      : [];

  const home = resolvePrimaryGroundingPage(siteContext);
  const siteBlurb = home?.metaDescription || home?.pageText?.slice(0, 180) || "";

  const emptySiteContext = {
    ok: false,
    error: "Site crawl data was not available when building this workflow. Re-analyze the website URL.",
    startUrl: inputs.url,
    domain: inputs.domain,
    discovery: {
      strategy: "local-fallback",
      pagesDiscovered: 0,
      pagesFetched: 0,
      pagesFailed: 0,
      sitemaps: [],
    },
    summary: {
      pageCount: 0,
      pageTypes: {},
      corePages: [],
      referenceImages: [],
    },
    pages: [],
    failures: [],
    events: [
      {
        type: "fallback",
        status: "warn",
        url: inputs.url,
        detail: "Site crawl was not available; local rules generated a template workflow.",
      },
    ],
  };

  const resolvedSiteContext = siteContext
    ? {
        ...siteContext,
        events: [
          ...(siteContext.events || []),
          {
            type: "ai-fallback",
            status: "warn",
            url: inputs.url,
            detail: siteContext.ok
              ? "AI generation failed; strategy and drafts use local rules with crawled site data."
              : "AI generation failed; local rules generated a template because the site crawl did not return pages.",
          },
        ],
      }
    : emptySiteContext;

  const refreshCandidates = buildRefreshCandidates(resolvedSiteContext);

  return {
    inputs: resolvedInputs,
    strategy: {
      positioning: siteBlurb
        ? `${resolvedInputs.domain} — ${siteBlurb}`
        : `${resolvedInputs.domain} is positioned as a ${resolvedInputs.category} offer for ${resolvedInputs.audience}.`,
      customer: resolvedInputs.audience,
      promise: `Help ${resolvedInputs.audience} ${resolvedInputs.goal} with content grounded in the live site.`,
      voice: voiceRules[resolvedInputs.voice]?.line || voiceRules.sharp.line,
      contentGap: inferContentGap(siteContext),
      publishingRule: inferPublishingRule(siteContext),
      refreshCandidates,
    },
    keywords,
    calendar,
    drafts,
    checklist: checklistItems,
    siteContext: resolvedSiteContext,
    calendarAudit: calendarAudit.summary,
  };
};
