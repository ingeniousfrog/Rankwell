const DEFAULT_SOURCE = "google-search-console";
const DEFAULT_LIMIT = 16;
const MIN_REFRESH_IMPRESSIONS = 50;
const MIN_EXPAND_IMPRESSIONS = 150;
const MIN_NEW_PAGE_IMPRESSIONS = 150;
const MIN_CANNIBALIZATION_IMPRESSIONS = 100;

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "best",
  "by",
  "for",
  "from",
  "how",
  "in",
  "is",
  "of",
  "on",
  "or",
  "the",
  "to",
  "vs",
  "what",
  "with",
]);

const INTENT_PATTERNS = [
  {
    id: "comparison",
    pattern: /\b(alternative|alternatives|compare|comparison|versus|vs)\b/i,
    pagePattern: /\b(alternative|alternatives|compare|comparison|versus|vs)\b/i,
    pageTypes: new Set(["comparison"]),
  },
  {
    id: "pricing",
    pattern: /\b(price|pricing|cost|costs|plans)\b/i,
    pagePattern: /\b(price|pricing|cost|plans)\b/i,
    pageTypes: new Set(["pricing"]),
  },
  {
    id: "template",
    pattern: /\b(template|templates|example|examples|checklist|checklists)\b/i,
    pagePattern: /\b(template|templates|example|examples|checklist|checklists)\b/i,
    pageTypes: new Set(["blog", "docs", "template"]),
  },
];

const cleanString = (value) => (typeof value === "string" ? value.trim() : "");

const toNumber = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
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

const tokenize = (value) =>
  cleanString(value)
    .toLowerCase()
    .replace(/['’]/g, "")
    .split(/[^a-z0-9]+/i)
    .map((token) => token.replace(/s$/, ""))
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));

const unique = (items) => [...new Set(items.filter(Boolean))];

const pageText = (page = {}) =>
  [page.url, page.pageType, page.title, page.h1, page.metaDescription, page.pageText]
    .map((item) => cleanString(item).toLowerCase())
    .filter(Boolean)
    .join(" ");

const expectedCtrForPosition = (position) => {
  if (position <= 3) return 0.12;
  if (position <= 5) return 0.07;
  if (position <= 10) return 0.04;
  if (position <= 20) return 0.025;
  return 0.015;
};

const impactScore = (row) => {
  const ctrGap = Math.max(0.005, expectedCtrForPosition(row.position) - row.ctr);
  const rankGap = Math.max(1, 31 - Math.min(row.position || 31, 31));
  return Math.round(row.impressions * ctrGap * 1000 + rankGap);
};

const priorityFor = (score, impressions) => {
  if (impressions >= 500 || score >= 80) return "high";
  if (impressions >= 150 || score >= 30) return "medium";
  return "low";
};

const findPage = (siteContext, pageUrl) => {
  const target = stableUrl(pageUrl);
  return (siteContext?.pages || []).find((page) => stableUrl(page.url) === target) || null;
};

const pageMatchesQuery = (page, query) => {
  if (!page) return false;
  const tokens = unique(tokenize(query));
  if (tokens.length === 0) return false;
  const text = pageText(page);
  const matches = tokens.filter((token) => text.includes(token));
  return matches.length >= Math.min(2, tokens.length);
};

const queryIntent = (query) => INTENT_PATTERNS.find((item) => item.pattern.test(query)) || null;

const pageMatchesIntent = (page, intent) => {
  if (!intent) return true;
  const type = cleanString(page?.pageType);
  if (intent.pageTypes.has(type)) return true;
  return intent.pagePattern.test(pageText(page));
};

const hasSuitableLandingPage = (siteContext, query) => {
  const intent = queryIntent(query);
  return (siteContext?.pages || []).some((page) => pageMatchesQuery(page, query) && pageMatchesIntent(page, intent));
};

const clusterKey = (query) => unique(tokenize(query)).slice(0, 2).join(" ");

const groupBy = (items, getKey) => {
  const grouped = new Map();
  for (const item of items) {
    const key = getKey(item);
    if (!key) continue;
    grouped.set(key, [...(grouped.get(key) || []), item]);
  }
  return grouped;
};

const aggregateMetrics = (rows) => {
  const clicks = rows.reduce((sum, row) => sum + row.clicks, 0);
  const impressions = rows.reduce((sum, row) => sum + row.impressions, 0);
  const ctr = impressions > 0 ? clicks / impressions : 0;
  const position =
    impressions > 0
      ? rows.reduce((sum, row) => sum + row.position * Math.max(row.impressions, 1), 0) /
        rows.reduce((sum, row) => sum + Math.max(row.impressions, 1), 0)
      : 0;
  return {
    clicks: Math.round(clicks * 100) / 100,
    impressions: Math.round(impressions * 100) / 100,
    ctr: Math.round(ctr * 10000) / 10000,
    position: Math.round(position * 10) / 10,
  };
};

export const normalizeSearchAnalyticsRows = (input, dimensions = ["query", "page"]) => {
  const rows = Array.isArray(input) ? input : Array.isArray(input?.rows) ? input.rows : [];
  return rows
    .map((row) => {
      const values = Array.isArray(row.keys) ? row.keys : [];
      const dimensionValues = Object.fromEntries(
        dimensions.map((dimension, index) => [dimension, cleanString(values[index])]),
      );
      return {
        query: cleanString(row.query || dimensionValues.query),
        page: stableUrl(row.page || dimensionValues.page),
        country: cleanString(row.country || dimensionValues.country),
        device: cleanString(row.device || dimensionValues.device),
        clicks: toNumber(row.clicks),
        impressions: toNumber(row.impressions),
        ctr: toNumber(row.ctr),
        position: toNumber(row.position),
      };
    })
    .filter((row) => row.query || row.page);
};

export const normalizeOpportunity = (item) => {
  const type = cleanString(item?.type) || "refresh";
  const metrics = item?.metrics && typeof item.metrics === "object" ? item.metrics : {};
  return {
    type,
    source: item?.source || DEFAULT_SOURCE,
    title: cleanString(item?.title) || `${type} opportunity`,
    query: cleanString(item?.query),
    page: stableUrl(item?.page),
    urls: Array.isArray(item?.urls) ? item.urls.map((url) => stableUrl(url)).filter(Boolean) : [],
    queries: Array.isArray(item?.queries) ? item.queries.slice(0, 8) : [],
    priority: item?.priority || "medium",
    reason: cleanString(item?.reason),
    metrics: {
      clicks: toNumber(metrics.clicks),
      impressions: toNumber(metrics.impressions),
      ctr: toNumber(metrics.ctr),
      position: toNumber(metrics.position),
    },
    recommendedActions: Array.isArray(item?.recommendedActions)
      ? item.recommendedActions.map((action) => cleanString(action)).filter(Boolean).slice(0, 6)
      : [],
  };
};

const buildRefreshOpportunities = (rows) =>
  rows
    .filter((row) => {
      if (row.impressions < MIN_REFRESH_IMPRESSIONS) return false;
      if (row.position < 8 || row.position > 30) return false;
      return row.ctr < Math.max(0.012, expectedCtrForPosition(row.position) * 0.65);
    })
    .map((row) => {
      const score = impactScore(row);
      return normalizeOpportunity({
        type: "refresh",
        title: `Refresh page for "${row.query}"`,
        query: row.query,
        page: row.page,
        priority: priorityFor(score, row.impressions),
        reason: `Ranks around position ${row.position.toFixed(1)} with ${row.impressions} impressions and ${(row.ctr * 100).toFixed(1)}% CTR.`,
        metrics: row,
        recommendedActions: [
          "Rewrite the title and meta description around the exact query intent.",
          "Add or tighten a paragraph that answers the query directly.",
          "Add FAQ coverage for close variants if the page format supports it.",
          "Add internal links from related pages to reinforce the target URL.",
        ],
      });
    });

const buildExpandOpportunities = (rows, siteContext) => {
  const byPageAndCluster = groupBy(rows, (row) => `${row.page}::${clusterKey(row.query)}`);
  const opportunities = [];

  for (const groupedRows of byPageAndCluster.values()) {
    const page = findPage(siteContext, groupedRows[0]?.page);
    if (!page || groupedRows.length < 3) continue;
    const metrics = aggregateMetrics(groupedRows);
    if (metrics.impressions < MIN_EXPAND_IMPRESSIONS) continue;

    const text = pageText(page);
    const missingAngles = unique(
      groupedRows
        .flatMap((row) => tokenize(row.query))
        .filter((token) => !text.includes(token)),
    ).slice(0, 6);

    opportunities.push(
      normalizeOpportunity({
        type: "expand",
        title: `Expand ${page.title || page.h1 || page.url}`,
        query: clusterKey(groupedRows[0].query),
        page: page.url,
        priority: priorityFor(impactScore(metrics), metrics.impressions),
        reason: `${groupedRows.length} related long-tail queries already land on this page, but coverage is incomplete.`,
        metrics,
        queries: [...groupedRows]
          .sort((left, right) => right.impressions - left.impressions)
          .slice(0, 8)
          .map((row) => ({
            query: row.query,
            impressions: row.impressions,
            clicks: row.clicks,
            ctr: row.ctr,
            position: row.position,
          })),
        recommendedActions: [
          `Add a subsection for ${missingAngles.length ? missingAngles.join(", ") : "the highest-impression variants"}.`,
          "Keep this as an expansion of the current URL instead of creating a duplicate article.",
          "Add jump links or internal anchors if the section grows beyond a short answer.",
        ],
      }),
    );
  }

  return opportunities;
};

const buildNewPageOpportunities = (rows, siteContext) =>
  rows
    .filter((row) => {
      if (row.impressions < MIN_NEW_PAGE_IMPRESSIONS) return false;
      return !hasSuitableLandingPage(siteContext, row.query);
    })
    .map((row) =>
      normalizeOpportunity({
        type: "newPage",
        title: `Create landing page for "${row.query}"`,
        query: row.query,
        page: "",
        priority: priorityFor(impactScore(row), row.impressions),
        reason: "No crawled page clearly matches this query intent, so the demand has no suitable landing page.",
        metrics: row,
        recommendedActions: [
          "Create a new page only if the query maps to a distinct user job.",
          "Choose a format that matches intent, such as comparison, template, guide, or use-case page.",
          "Link from the closest existing page after publishing.",
        ],
      }),
    );

const buildCannibalizationOpportunities = (rows) => {
  const byQuery = groupBy(rows, (row) => row.query.toLowerCase());
  const opportunities = [];

  for (const [query, groupedRows] of byQuery.entries()) {
    const urls = unique(groupedRows.map((row) => row.page));
    if (urls.length < 2) continue;
    const metrics = aggregateMetrics(groupedRows);
    if (metrics.impressions < MIN_CANNIBALIZATION_IMPRESSIONS) continue;

    opportunities.push(
      normalizeOpportunity({
        type: "cannibalization",
        title: `Resolve split ranking for "${query}"`,
        query,
        urls,
        priority: priorityFor(impactScore(metrics), metrics.impressions),
        reason: `The same query is split across ${urls.length} URLs, which can dilute clicks and ranking signals.`,
        metrics,
        queries: [...groupedRows]
          .sort((left, right) => right.impressions - left.impressions)
          .map((row) => ({
            query: row.query,
            page: row.page,
            impressions: row.impressions,
            clicks: row.clicks,
            ctr: row.ctr,
            position: row.position,
          })),
        recommendedActions: [
          "Pick the strongest URL as the primary target for this query.",
          "Merge overlapping content, then add canonical or redirect signals where appropriate.",
          "Retain distinct pages only if they serve clearly different search intents.",
        ],
      }),
    );
  }

  return opportunities;
};

const opportunityRank = (item) => {
  const typeRank = { cannibalization: 0, refresh: 1, expand: 2, newPage: 3 };
  const priorityRank = { high: 0, medium: 1, low: 2 };
  return [
    typeRank[item.type] ?? 9,
    priorityRank[item.priority] ?? 9,
    -(item.metrics?.impressions || 0),
    item.title,
  ];
};

const compareRank = (left, right) => {
  const leftRank = opportunityRank(left);
  const rightRank = opportunityRank(right);
  for (let index = 0; index < leftRank.length; index += 1) {
    if (leftRank[index] < rightRank[index]) return -1;
    if (leftRank[index] > rightRank[index]) return 1;
  }
  return 0;
};

export const buildSeoOpportunities = ({ performanceRows, siteContext, options = {} } = {}) => {
  const rows = normalizeSearchAnalyticsRows(performanceRows || [], ["query", "page", "country", "device"]);
  const opportunities = [
    ...buildCannibalizationOpportunities(rows),
    ...buildRefreshOpportunities(rows),
    ...buildExpandOpportunities(rows, siteContext),
    ...buildNewPageOpportunities(rows, siteContext),
  ]
    .map((item) => normalizeOpportunity(item))
    .sort(compareRank)
    .slice(0, options.limit || DEFAULT_LIMIT);

  const summary = aggregateMetrics(rows);
  return {
    source: DEFAULT_SOURCE,
    status: rows.length > 0 ? "available" : "empty",
    rowCount: rows.length,
    totalClicks: summary.clicks,
    totalImpressions: summary.impressions,
    averageCtr: summary.ctr,
    averagePosition: summary.position,
    items: opportunities,
    limitations: [
      "Search Console hides some low-volume or anonymized queries.",
      "This is owned-site performance data, not third-party search volume or SERP competition data.",
    ],
  };
};
