import { normalizePlanLength } from "./plan-length.js";
import { normalizeOpportunity } from "./seo-opportunities.js";

const DEFAULT_METRICS = {
  clicks: 0,
  impressions: 0,
  ctr: 0,
  position: 0,
};

export const DRAFT_MODES = {
  refresh: "refreshBrief",
  expand: "expandBrief",
  newPage: "newPageDraft",
  cannibalization: "governance",
  crawlFallback: "newPageDraft",
};

export const ACTION_LABELS = {
  refreshBrief: "Refresh brief",
  expandBrief: "Section brief",
  newPageDraft: "New page draft",
  governance: "Governance",
};

const cleanString = (value, fallback = "") => (typeof value === "string" && value.trim() ? value.trim() : fallback);

const toNumber = (value) => {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
};

const stableUrl = (value) => {
  const raw = cleanString(value);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    url.hash = "";
    return url.toString();
  } catch {
    return raw;
  }
};

const slugify = (value, fallback = "topic") =>
  cleanString(value, fallback)
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72) || fallback;

const titleCaseQuery = (value) =>
  cleanString(value, "Search opportunity")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

const findPageByUrl = (siteContext, url) => {
  const target = stableUrl(url);
  return (siteContext?.pages || []).find((page) => stableUrl(page.url) === target) || null;
};

const normalizeMetrics = (metrics = {}) => ({
  clicks: toNumber(metrics.clicks),
  impressions: toNumber(metrics.impressions),
  ctr: toNumber(metrics.ctr),
  position: toNumber(metrics.position ?? metrics.avgPosition),
});

const normalizeActions = (actions) =>
  Array.isArray(actions) ? actions.map((action) => cleanString(action)).filter(Boolean).slice(0, 8) : [];

const normalizeQueries = (queries) =>
  Array.isArray(queries)
    ? queries
        .map((item) =>
          typeof item === "string"
            ? { query: cleanString(item) }
            : {
                query: cleanString(item?.query),
                page: stableUrl(item?.page || item?.url),
                clicks: toNumber(item?.clicks),
                impressions: toNumber(item?.impressions),
                ctr: toNumber(item?.ctr),
                position: toNumber(item?.position),
              },
        )
        .filter((item) => item.query || item.page)
        .slice(0, 8)
    : [];

const normalizeUrls = (urls) =>
  Array.isArray(urls) ? [...new Set(urls.map((url) => stableUrl(url)).filter(Boolean))].slice(0, 8) : [];

const rootUrlFor = (inputs = {}, siteContext = null) => {
  const raw = cleanString(siteContext?.startUrl || inputs.url, "https://example.com/");
  try {
    return new URL(raw);
  } catch {
    return new URL("https://example.com/");
  }
};

const inferNewPageUrl = (query, inputs, siteContext) => {
  const root = rootUrlFor(inputs, siteContext);
  const slug = slugify(query || inputs.category || "topic");
  const pathPrefix = /\b(alternative|alternatives|compare|comparison|vs|versus)\b/i.test(query) ? "/compare/" : "/blog/";
  return new URL(`${pathPrefix}${slug}`, root).toString();
};

const firstTargetUrl = (item, inputs, siteContext, opportunityType) => {
  const urls = normalizeUrls(item.urls);
  const explicit = stableUrl(item.targetUrl || item.placementUrl || item.page || item.url || urls[0]);
  if (explicit) return explicit;
  if (opportunityType === "newPage") return inferNewPageUrl(item.query || item.keyword || item.title, inputs, siteContext);
  return "";
};

const inferNewPageTitle = (item, inputs) => {
  const query = cleanString(item.query || item.keyword || item.title, inputs.category || "topic");
  if (/\b(alternative|alternatives|compare|comparison|vs|versus)\b/i.test(query)) {
    const trimmed = query.replace(/\b(alternative|alternatives|compare|comparison|vs|versus)\b/gi, "").trim();
    return `Best ${trimmed || query} options for ${inputs.audience || "buyers"}`;
  }
  if (/^(how|what|why|when|where|can|should)\b/i.test(query)) return titleCaseQuery(query);
  return `How to ${query}`;
};

const taskTitleFor = (item, opportunityType, targetUrl, siteContext, inputs) => {
  if (item.title && opportunityType === "crawlFallback") return cleanString(item.title);
  if (opportunityType === "newPage") return inferNewPageTitle(item, inputs);
  const page = findPageByUrl(siteContext, targetUrl);
  const label = page?.title || page?.h1 || item.query || item.keyword || targetUrl || item.title;
  if (opportunityType === "refresh") return `Refresh brief: ${label}`;
  if (opportunityType === "expand") return `Section brief: ${label}`;
  if (opportunityType === "cannibalization") return `Governance: ${item.query || label}`;
  return cleanString(item.title, titleCaseQuery(item.keyword || item.query || label));
};

const intentFor = (item, opportunityType) => {
  if (item.intent) return item.intent;
  if (opportunityType === "refresh") return "Refresh";
  if (opportunityType === "expand") return "Expand";
  if (opportunityType === "cannibalization") return "Governance";
  if (/\b(alternative|alternatives|compare|comparison|vs|versus)\b/i.test(item.query || item.keyword || item.title)) {
    return "Comparison";
  }
  return "Problem";
};

const formatFor = (item, opportunityType) => {
  if (item.format) return item.format;
  if (opportunityType === "refresh") return "refresh brief";
  if (opportunityType === "expand") return "section brief";
  if (opportunityType === "cannibalization") return "governance";
  if (/\b(alternative|alternatives|compare|comparison|vs|versus)\b/i.test(item.query || item.keyword || item.title)) {
    return "comparison";
  }
  return "guide";
};

const placementFor = (item, opportunityType) => {
  if (item.placement) return item.placement;
  if (opportunityType === "refresh") return "existing page";
  if (opportunityType === "expand") return "existing page section";
  if (opportunityType === "cannibalization") return "site structure governance";
  if (opportunityType === "newPage") return /comparison/i.test(formatFor(item, opportunityType)) ? "comparison page" : "blog";
  return "blog";
};

const modeForType = (opportunityType, item = {}) => item.draftMode || DRAFT_MODES[opportunityType] || "newPageDraft";

const isDraftableMode = (draftMode) => draftMode !== "governance";

const sourceOpportunityIdFor = (item, opportunityType, index, targetUrl) => {
  if (opportunityType === "crawlFallback") return cleanString(item.sourceOpportunityId);
  return (
    cleanString(item.id || item.sourceOpportunityId) ||
    `${opportunityType}-${slugify(item.query || item.keyword || targetUrl || item.title)}-${index + 1}`
  );
};

export const normalizePlanItem = (item, options = {}) => {
  const source = item && typeof item === "object" ? item : {};
  const index = Number.isInteger(options.index) ? options.index : 0;
  const inputs = options.inputs || {};
  const siteContext = options.siteContext || null;
  const opportunityType = source.opportunityType || options.opportunityType || "crawlFallback";
  const draftMode = modeForType(opportunityType, source);
  const targetUrl = firstTargetUrl(source, inputs, siteContext, opportunityType);
  const sourceOpportunityId = sourceOpportunityIdFor(source, opportunityType, index, targetUrl);
  const id =
    cleanString(source.id) ||
    (sourceOpportunityId ? `plan-${slugify(sourceOpportunityId)}-${index + 1}` : `plan-crawl-${slugify(source.title || source.keyword)}-${index + 1}`);
  const metrics = normalizeMetrics(source.opportunityMetrics || source.metrics || DEFAULT_METRICS);
  const title = taskTitleFor(source, opportunityType, targetUrl, siteContext, inputs);
  const keyword = cleanString(source.keyword || source.query || source.title, inputs.category || title);
  const urls = normalizeUrls(source.urls || (targetUrl ? [targetUrl] : []));

  return {
    ...source,
    id,
    day: Number(source.day || index + 1),
    title,
    keyword,
    intent: intentFor(source, opportunityType),
    format: formatFor(source, opportunityType),
    placement: placementFor(source, opportunityType),
    placementUrl: source.placementUrl || (draftMode === "newPageDraft" ? "" : targetUrl),
    targetUrl,
    opportunityType,
    sourceOpportunityId,
    draftMode,
    isDraftable: source.isDraftable === false ? false : isDraftableMode(draftMode),
    opportunityMetrics: metrics,
    recommendedActions: normalizeActions(source.recommendedActions),
    actionLabel: ACTION_LABELS[draftMode] || "New page draft",
    query: cleanString(source.query || source.keyword),
    queries: normalizeQueries(source.queries),
    urls,
    reason: cleanString(source.reason),
  };
};

const opportunityToPlanItem = (opportunity, options) => {
  const normalized = {
    ...normalizeOpportunity(opportunity),
    id: opportunity?.id || opportunity?.sourceOpportunityId || "",
  };
  return normalizePlanItem(
    {
      ...normalized,
      opportunityType: normalized.type,
      sourceOpportunityId: normalized.id,
      opportunityMetrics: normalized.metrics,
    },
    {
      ...options,
      opportunityType: normalized.type,
    },
  );
};

export const buildOpportunityBackedPlan = ({
  opportunities = [],
  fallbackCalendar = [],
  planLength,
  siteContext = null,
  inputs = {},
} = {}) => {
  const targetLength = normalizePlanLength(planLength || inputs.planLength);
  const mappedOpportunities = (Array.isArray(opportunities) ? opportunities : [])
    .slice(0, targetLength)
    .map((opportunity, index) =>
      opportunityToPlanItem(opportunity, {
        index,
        inputs,
        siteContext,
      }),
    );
  const fallbackItems = (Array.isArray(fallbackCalendar) ? fallbackCalendar : []).map((item, index) =>
    normalizePlanItem(item, {
      index: mappedOpportunities.length + index,
      inputs,
      siteContext,
      opportunityType: item?.opportunityType || "crawlFallback",
    }),
  );
  const combined = mappedOpportunities.length > 0 ? [...mappedOpportunities, ...fallbackItems] : fallbackItems;

  return combined.slice(0, targetLength).map((item, index) => ({
    ...item,
    day: index + 1,
  }));
};
