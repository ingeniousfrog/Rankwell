const cleanString = (value, fallback = "") => (typeof value === "string" && value.trim() ? value.trim() : fallback);

const formatPercent = (value) => {
  const number = Number(value || 0);
  return Number.isFinite(number) ? `${(number * 100).toFixed(1)}%` : "0.0%";
};

const formatPosition = (value) => {
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? number.toFixed(1) : "n/a";
};

const findPage = (siteContext, targetUrl) => {
  const target = cleanString(targetUrl);
  if (!target) return null;
  return (siteContext?.pages || []).find((page) => page.url === target) || null;
};

const topQueries = (calendarItem) => {
  const queries = Array.isArray(calendarItem.queries) ? calendarItem.queries : [];
  const seeded = queries.length ? queries : [{ query: calendarItem.query || calendarItem.keyword }];
  return seeded
    .map((item) =>
      typeof item === "string"
        ? { query: item }
        : {
            query: cleanString(item.query || item.keyword),
            page: cleanString(item.page || item.url),
            impressions: Number(item.impressions || 0),
            clicks: Number(item.clicks || 0),
            ctr: Number(item.ctr || 0),
            position: Number(item.position || 0),
          },
    )
    .filter((item) => item.query)
    .slice(0, 5);
};

const metricsLine = (calendarItem) => {
  const metrics = calendarItem.opportunityMetrics || calendarItem.metrics || {};
  const impressions = Number(metrics.impressions || 0);
  const clicks = Number(metrics.clicks || 0);
  return `${Math.round(impressions)} impressions, ${Math.round(clicks)} clicks, ${formatPercent(metrics.ctr)} CTR, avg position ${formatPosition(metrics.position)}`;
};

const pageLabel = (page, calendarItem) =>
  cleanString(page?.title || page?.h1 || calendarItem.targetUrl || calendarItem.placementUrl, calendarItem.title);

const evidenceRefs = (calendarItem, siteContext) => {
  const targetUrl = calendarItem.targetUrl || calendarItem.placementUrl;
  const targetPage = findPage(siteContext, targetUrl);
  const refs = [];
  if (targetPage) {
    refs.push({
      url: targetPage.url,
      pageTitle: targetPage.title || targetPage.h1 || "Target page",
      source: "website",
      quote: targetPage.metaDescription || targetPage.h1 || targetPage.title || "Target page from crawl.",
      usedFor: "Target URL evidence for this opportunity.",
    });
  } else if (targetUrl) {
    refs.push({
      url: targetUrl,
      pageTitle: "Target URL",
      source: "google-search-console",
      quote: "Search Console reported this URL for the selected query.",
      usedFor: "Target URL evidence for this opportunity.",
    });
  }
  const supportingPage = (siteContext?.pages || []).find((page) => page.url && page.url !== targetUrl);
  if (supportingPage) {
    refs.push({
      url: supportingPage.url,
      pageTitle: supportingPage.title || supportingPage.h1 || "Supporting page",
      source: "website",
      quote: supportingPage.metaDescription || supportingPage.h1 || supportingPage.title || "Supporting crawled page.",
      usedFor: "Internal link or context source.",
    });
  }
  return refs.slice(0, 4);
};

const qaChecks = (mode, targetUrl) => [
  {
    label: "Opportunity mode",
    status: "pass",
    detail: mode === "refreshBrief" ? "This task updates an existing page instead of creating a new article." : "This task adds a subsection to an existing URL instead of creating a duplicate page.",
  },
  {
    label: "Target URL",
    status: targetUrl ? "pass" : "warn",
    detail: targetUrl ? `Brief is anchored to ${targetUrl}.` : "No target URL was available; choose a landing page before execution.",
  },
  {
    label: "GSC evidence",
    status: "pass",
    detail: "Uses owned-site Search Console metrics as directional evidence, not external search volume or keyword difficulty.",
  },
];

const visualPlan = {
  recommended: "none",
  reason: "This is an editing brief, not a publishable visual article draft.",
  promptOrSpec: "No new visual asset required unless the target page needs a screenshot update.",
  referenceImages: [],
};

const schemaSuggestion = {
  type: "Review existing schema",
  reason: "Keep or adjust the current page schema after the copy update, rather than assuming a new Article schema.",
};

const refreshBlocks = (calendarItem, targetLabel) => {
  const query = calendarItem.query || calendarItem.keyword;
  const actions = calendarItem.recommendedActions || [];
  return [
    {
      type: "brief",
      heading: "Target URL and search evidence",
      body: `${calendarItem.targetUrl || calendarItem.placementUrl || "Select a target URL"} currently has opportunity around "${query}". GSC metrics: ${metricsLine(calendarItem)}.`,
    },
    {
      type: "brief",
      heading: "Title and meta rewrite",
      body: `Rewrite the title and meta description for ${targetLabel} so the primary promise answers "${query}" directly while preserving the page's existing intent.`,
    },
    {
      type: "brief",
      heading: "Paragraphs to add or tighten",
      body: `Add one direct-answer paragraph near the first relevant section, then add supporting detail for adjacent variants. ${actions.join(" ")}`,
    },
    {
      type: "faq",
      heading: "FAQ additions",
      items: topQueries(calendarItem).slice(0, 3).map((item) => ({
        question: `What should this page answer about ${item.query}?`,
        answer: `Give a concise answer on the target page and link to the most relevant supporting page if the answer needs more detail.`,
      })),
    },
    {
      type: "brief",
      heading: "Internal links",
      body: "Add contextual internal links from closely related pages to reinforce the refreshed target URL. Use descriptive anchors based on the query cluster, not generic click text.",
    },
  ];
};

const expandBlocks = (calendarItem, targetLabel) => {
  const queries = topQueries(calendarItem);
  const covered = queries.map((item) => item.query).join(", ") || calendarItem.keyword;
  return [
    {
      type: "brief",
      heading: "Insertion point",
      body: `Add the new subsection to ${targetLabel} near the first section that discusses ${calendarItem.keyword || calendarItem.query}. Keep it on the existing URL: ${calendarItem.targetUrl || calendarItem.placementUrl || "choose target URL"}.`,
    },
    {
      type: "brief",
      heading: "Subsection title",
      body: `Suggested H2/H3: "${calendarItem.keyword || calendarItem.query}: examples, checklist, and next steps".`,
    },
    {
      type: "brief",
      heading: "Long-tail query coverage",
      body: `Cover these observed queries in one cohesive subsection instead of creating duplicate articles: ${covered}. GSC metrics: ${metricsLine(calendarItem)}.`,
    },
    {
      type: "brief",
      heading: "Paragraph outline",
      body: "Open with a direct answer, add a short example or checklist, then close with a link to the next product or documentation page.",
    },
    {
      type: "faq",
      heading: "FAQ and internal link prompts",
      items: queries.slice(0, 3).map((item) => ({
        question: `How should the page answer "${item.query}"?`,
        answer: "Answer in 1-2 sentences, then point readers to the most relevant existing page for depth.",
      })),
    },
  ];
};

export const buildOpportunityBrief = (calendarItem = {}, input = {}, siteContext = null) => {
  const draftMode = calendarItem.draftMode;
  if (!["refreshBrief", "expandBrief"].includes(draftMode)) {
    throw new Error(`Unsupported opportunity brief mode: ${draftMode || "unknown"}.`);
  }
  const targetUrl = calendarItem.targetUrl || calendarItem.placementUrl || "";
  const page = findPage(siteContext, targetUrl);
  const targetLabel = pageLabel(page, calendarItem);
  const isRefresh = draftMode === "refreshBrief";
  const blocks = isRefresh ? refreshBlocks(calendarItem, targetLabel) : expandBlocks(calendarItem, targetLabel);
  const templateLabel = isRefresh ? "Refresh brief" : "Section expansion brief";
  return {
    title: `${templateLabel}: ${targetLabel}`,
    meta: `${templateLabel} for ${input.domain || "the site"} targeting "${calendarItem.keyword || calendarItem.query || "the selected query"}".`,
    draftMode,
    sourceCalendarItemId: calendarItem.id || "",
    sourceOpportunityId: calendarItem.sourceOpportunityId || "",
    opportunityType: calendarItem.opportunityType || (isRefresh ? "refresh" : "expand"),
    targetUrl,
    templateId: isRefresh ? "refreshBrief" : "expandBrief",
    templateLabel,
    placement: isRefresh ? "Existing page refresh" : "Existing page section expansion",
    placementUrl: targetUrl,
    placementStrategy: isRefresh ? "refresh existing URL" : "expand existing URL",
    sections: [],
    blocks,
    faq: blocks.find((block) => block.type === "faq")?.items?.map((item) => `${item.question} ${item.answer}`) || [],
    cta: "Update the existing page, then monitor GSC query/page performance for the same target URL.",
    evidenceRefs: evidenceRefs(calendarItem, siteContext),
    qaChecks: qaChecks(draftMode, targetUrl),
    visualPlan,
    schemaSuggestion,
    draftRuntime: {
      mode: draftMode,
      opportunityType: calendarItem.opportunityType || (isRefresh ? "refresh" : "expand"),
      metrics: calendarItem.opportunityMetrics || calendarItem.metrics || {},
      queries: topQueries(calendarItem),
    },
  };
};
