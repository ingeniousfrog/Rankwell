export const DRAFT_REQUEST_MAX_BYTES = 28_000;

const copyText = (value) => (typeof value === "string" ? value.trim() : value);

const copyNumber = (value) => {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
};

const pick = (source, keys) =>
  keys.reduce((next, key) => {
    if (source?.[key] === undefined || source?.[key] === null || source?.[key] === "") return next;
    return { ...next, [key]: copyText(source[key]) };
  }, {});

const compactMetrics = (metrics = {}) => ({
  clicks: copyNumber(metrics.clicks),
  impressions: copyNumber(metrics.impressions),
  ctr: copyNumber(metrics.ctr),
  position: copyNumber(metrics.position ?? metrics.avgPosition),
});

const compactQueries = (queries) =>
  Array.isArray(queries)
    ? queries
        .slice(0, 5)
        .map((item) =>
          typeof item === "string"
            ? { query: item }
            : pick(item, ["query", "page", "url", "clicks", "impressions", "ctr", "position"]),
        )
        .filter((item) => item.query || item.page || item.url)
    : [];

const compactUrls = (urls) =>
  Array.isArray(urls)
    ? urls
        .slice(0, 5)
        .map((url) => (typeof url === "string" ? url.trim() : ""))
        .filter(Boolean)
    : [];

const compactActions = (actions) =>
  Array.isArray(actions)
    ? actions
        .slice(0, 6)
        .map((action) => (typeof action === "string" ? action.trim() : ""))
        .filter(Boolean)
    : [];

export const compactCalendarItemForDraft = (calendarItem = {}) => {
  const compact = {
    ...pick(calendarItem, [
      "id",
      "day",
      "title",
      "keyword",
      "query",
      "intent",
      "format",
      "placement",
      "placementUrl",
      "targetUrl",
      "opportunityType",
      "sourceOpportunityId",
      "draftMode",
      "reason",
      "priority",
      "actionLabel",
    ]),
    isDraftable: calendarItem.isDraftable !== false,
    opportunityMetrics: compactMetrics(calendarItem.opportunityMetrics || calendarItem.metrics || {}),
    recommendedActions: compactActions(calendarItem.recommendedActions),
    queries: compactQueries(calendarItem.queries),
    urls: compactUrls(calendarItem.urls),
  };

  return Object.fromEntries(
    Object.entries(compact).filter(([, value]) => {
      if (Array.isArray(value)) return value.length > 0;
      if (value && typeof value === "object") return Object.values(value).some((item) => item !== 0 && item !== "");
      return value !== undefined && value !== null && value !== "";
    }),
  );
};

const compactInputForDraft = (input = {}) =>
  pick(input, ["url", "domain", "category", "audience", "goal", "voice", "planLength", "includeDraft"]);

const payloadBytes = (text) => new TextEncoder().encode(text).length;

export const buildDraftRequestPayload = ({ input = {}, calendarItem = {}, existingTitles = [] } = {}) => {
  const body = {
    input: compactInputForDraft(input),
    calendarItem: compactCalendarItemForDraft(calendarItem),
    existingTitles: Array.isArray(existingTitles) ? existingTitles.filter((title) => typeof title === "string").slice(0, 30) : [],
  };
  const text = JSON.stringify(body);
  const bytes = payloadBytes(text);
  if (bytes > DRAFT_REQUEST_MAX_BYTES) {
    throw new Error(
      `Draft request is too large (${bytes} bytes). Re-analyze the site or shorten the selected plan item before generating.`,
    );
  }
  return {
    body,
    text,
    bytes,
  };
};
