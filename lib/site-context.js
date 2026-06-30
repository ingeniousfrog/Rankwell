import { crawlProgressValue } from "./generate-progress.js";
import { extractPageSnapshot } from "./html-extractor.js";
import { getDefaultSitemapUrls, getRobotsUrl, parseRobotsTxt, parseSitemapXml } from "./site-discovery.js";
import {
  buildCrawlUrlCandidates,
  cleanDomain,
  isSameOrigin,
  normalizePageUrl,
  shouldSkipUrl,
  uniqueUrls,
} from "./url-utils.js";

const DEFAULT_LIMITS = {
  maxPages: 60,
  maxDepth: 3,
  maxSitemaps: 12,
};

const requestHeaders = {
  "User-Agent": "Rankwell/0.2 local site analyzer",
  Accept: "text/html,application/xhtml+xml,application/xml,text/xml,text/plain",
};

const emptyRobots = (siteUrl) => parseRobotsTxt("", siteUrl);

const readResponseText = async (response) => {
  const text = await response.text();
  return text.slice(0, 1_500_000);
};

const formatFetchError = (error) => {
  const message = error instanceof Error ? error.message : String(error);
  const cause = error && typeof error === "object" ? error.cause : null;
  const causeCode = typeof cause?.code === "string" ? cause.code : "";
  const causeMessage =
    cause instanceof Error
      ? cause.message
      : typeof cause?.message === "string"
        ? cause.message
        : "";
  const detail = [causeCode, causeMessage].filter(Boolean).join(": ");
  const fullMessage = detail && detail !== message ? `${message} (${detail})` : message;
  return fullMessage.slice(0, 320);
};

const fetchText = async (fetchImpl, url) => {
  try {
    const response = await fetchImpl(url, { method: "GET", headers: requestHeaders });
    const contentType = response.headers.get("content-type") || "";
    if (!response.ok) {
      return { ok: false, url, status: response.status, contentType, text: "" };
    }
    return {
      ok: true,
      url,
      status: response.status,
      contentType,
      text: await readResponseText(response),
    };
  } catch (error) {
    return {
      ok: false,
      url,
      status: 0,
      contentType: "",
      text: "",
      error: formatFetchError(error),
    };
  }
};

const fetchRobots = async (fetchImpl, siteUrl) => {
  const robotsUrl = getRobotsUrl(siteUrl);
  const response = await fetchText(fetchImpl, robotsUrl);
  return {
    url: robotsUrl,
    ok: response.ok,
    robots: response.ok ? parseRobotsTxt(response.text, siteUrl) : emptyRobots(siteUrl),
    error: response.ok ? "" : response.error || `HTTP ${response.status}`,
  };
};

const collectSitemapUrls = async ({ fetchImpl, siteUrl, robots, limits }) => {
  const sitemapSeeds = robots.sitemaps.length > 0 ? robots.sitemaps : getDefaultSitemapUrls(siteUrl);
  const queue = [...sitemapSeeds];
  const visited = new Set();
  const pages = [];
  const sitemaps = [];
  const failures = [];
  const urlMeta = {};

  while (queue.length > 0 && visited.size < limits.maxSitemaps && pages.length < limits.maxPages) {
    const sitemapUrl = queue.shift();
    if (!sitemapUrl || visited.has(sitemapUrl)) continue;
    visited.add(sitemapUrl);
    const response = await fetchText(fetchImpl, sitemapUrl);
    if (!response.ok) {
      failures.push({ url: sitemapUrl, reason: response.error || `HTTP ${response.status}` });
      continue;
    }

    sitemaps.push(sitemapUrl);
    const parsed = parseSitemapXml(response.text, siteUrl);
    Object.assign(urlMeta, parsed.urlMeta || {});
    queue.push(...parsed.sitemaps.filter((url) => !visited.has(url)));
    pages.push(...parsed.urls.filter((url) => robots.canCrawl(url)));
  }

  return {
    urls: uniqueUrls(pages).slice(0, limits.maxPages),
    sitemaps,
    failures,
    urlMeta,
  };
};

const pageFailure = (url, response) => ({
  url,
  reason: response.error || `HTTP ${response.status}${response.contentType ? ` ${response.contentType}` : ""}`,
});

const fetchPageSnapshot = async (fetchImpl, pageUrl) => {
  const response = await fetchText(fetchImpl, pageUrl);
  if (!response.ok) return { ok: false, failure: pageFailure(pageUrl, response) };
  if (!/text\/html|application\/xhtml\+xml/i.test(response.contentType)) {
    return { ok: false, failure: { url: pageUrl, reason: `Non-HTML response: ${response.contentType || "unknown"}` } };
  }
  return {
    ok: true,
    page: extractPageSnapshot(response.text, pageUrl),
  };
};

const summarizePages = (pages) => {
  const pageTypes = pages.reduce(
    (acc, page) => ({
      ...acc,
      [page.pageType]: (acc[page.pageType] || 0) + 1,
    }),
    {},
  );
  const corePages = pages
    .filter((page) => ["home", "pricing", "product", "docs", "proof"].includes(page.pageType))
    .slice(0, 12)
    .map((page) => ({
      url: page.url,
      title: page.title || page.h1 || page.url,
      pageType: page.pageType,
    }));
  const images = pages
    .flatMap((page) =>
      page.images.map((image) => ({
        ...image,
        pageUrl: page.url,
        pageTitle: page.title || page.h1 || page.url,
      })),
    )
    .slice(0, 24);

  return {
    pageCount: pages.length,
    pageTypes,
    corePages,
    referenceImages: images,
  };
};

const appendQueueItems = (queue, links, depth, seen, siteUrl, robots) => [
  ...queue,
  ...links
    .filter((link) => !seen.has(link))
    .filter((link) => isSameOrigin(link, siteUrl) && !shouldSkipUrl(link) && robots.canCrawl(link))
    .map((link) => ({ url: link, depth })),
];

const NETWORK_FAILURE_PATTERN =
  /fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|aborted|timeout|certificate|getaddrinfo/i;

const resolveCrawlFailureKind = ({ startUrl, sitemapPageUrls, robots, pages, failures }) => {
  const crawlCandidates = uniqueUrls([startUrl, ...sitemapPageUrls])
    .filter((candidate) => isSameOrigin(candidate, startUrl))
    .filter((candidate) => !shouldSkipUrl(candidate));

  if (
    crawlCandidates.length > 0 &&
    crawlCandidates.every((candidate) => !robots.canCrawl(candidate))
  ) {
    return "robots-blocked";
  }

  const pageFailures = failures.filter((failure) => {
    const url = failure.url || "";
    return crawlCandidates.some((candidate) => candidate === url);
  });

  if (
    pages.length === 0 &&
    pageFailures.some((failure) => NETWORK_FAILURE_PATTERN.test(failure.reason || ""))
  ) {
    return "fetch-failed";
  }

  return "no-pages";
};

const buildCrawlFailureMessage = (failureKind) => {
  if (failureKind === "robots-blocked") {
    return "robots.txt disallows crawling this site for Rankwell's user agent.";
  }
  if (failureKind === "fetch-failed") {
    return "Pages could not be fetched from this site.";
  }
  return "No crawlable HTML pages were fetched.";
};

const buildCrawlFailureHint = (attemptedUrls = [], failureKind = "no-pages") => {
  if (failureKind === "robots-blocked") {
    return " Rankwell respects robots.txt and will not crawl disallowed paths.";
  }
  const primary = attemptedUrls[0] || "";
  if (/:\/\/www\./i.test(primary)) {
    return " The www host failed — try the apex domain without www.";
  }
  if (attemptedUrls.length > 1) {
    return " Both www and apex hosts were tried. Confirm the site is publicly reachable.";
  }
  return " Confirm the URL is correct and the site returns HTML over HTTPS.";
};

const createSiteContextForStartUrl = async ({ startUrl, fetchImpl, limits, onProgress }) => {
  const boundedLimits = { ...DEFAULT_LIMITS, ...limits };
  const events = [];
  onProgress?.({
    stageId: "discover",
    progress: 6,
    detail: "Resolving site entry point",
  });
  const robotsResult = await fetchRobots(fetchImpl, startUrl);
  events.push({
    type: "robots",
    status: robotsResult.ok ? "pass" : "warn",
    url: robotsResult.url,
    detail: robotsResult.ok ? "robots.txt loaded" : robotsResult.error,
  });
  const sitemapResult = await collectSitemapUrls({
    fetchImpl,
    siteUrl: startUrl,
    robots: robotsResult.robots,
    limits: boundedLimits,
  });
  onProgress?.({
    stageId: "robots-sitemap",
    detail: robotsResult.ok ? "robots.txt loaded" : "Continuing without robots.txt",
  });
  events.push({
    type: "sitemap",
    status: sitemapResult.urls.length > 0 ? "pass" : "warn",
    url: sitemapResult.sitemaps[0] || "",
    detail:
      sitemapResult.urls.length > 0
        ? `${sitemapResult.urls.length} page URLs discovered from sitemap`
        : "No sitemap page URLs discovered; falling back to same-origin crawl",
  });
  const sitemapPageUrls = sitemapResult.urls.filter((candidate) => !shouldSkipUrl(candidate));
  const strategy = sitemapPageUrls.length > 0 ? "sitemap" : "crawl";
  const urlMeta = sitemapResult.urlMeta || {};
  const initialUrls = uniqueUrls([startUrl, ...sitemapPageUrls])
    .filter((candidate) => isSameOrigin(candidate, startUrl))
    .filter((candidate) => !shouldSkipUrl(candidate) && robotsResult.robots.canCrawl(candidate))
    .slice(0, boundedLimits.maxPages);

  const crawlTarget = Math.max(initialUrls.length, 1);
  onProgress?.({
    stageId: "crawl",
    progress: crawlProgressValue(0, crawlTarget),
    detail: `0/${crawlTarget} pages`,
  });

  let queue = initialUrls.map((candidate) => ({ url: candidate, depth: 0 }));
  const seen = new Set();
  const pages = [];
  const failures = [...sitemapResult.failures];

  while (queue.length > 0 && pages.length < boundedLimits.maxPages) {
    const next = queue.shift();
    if (!next || seen.has(next.url)) continue;
    seen.add(next.url);
    const result = await fetchPageSnapshot(fetchImpl, next.url);
    if (!result.ok) {
      failures.push(result.failure);
      events.push({
        type: "page",
        status: "fail",
        url: next.url,
        detail: result.failure.reason,
      });
      continue;
    }

    pages.push({
      ...result.page,
      sitemapLastmod: urlMeta[result.page.url]?.lastmod || urlMeta[next.url]?.lastmod || "",
    });
    onProgress?.({
      stageId: "crawl",
      progress: crawlProgressValue(pages.length, crawlTarget),
      detail: `${pages.length}/${crawlTarget} pages`,
    });
    events.push({
      type: "page",
      status: "pass",
      url: result.page.url,
      detail: `${result.page.pageType} page fetched`,
    });
    if (strategy === "crawl" && next.depth < boundedLimits.maxDepth) {
      queue = appendQueueItems(queue, result.page.links, next.depth + 1, seen, startUrl, robotsResult.robots);
    }
  }

  const summary = summarizePages(pages);
  const failureKind =
    pages.length > 0
      ? ""
      : resolveCrawlFailureKind({
          startUrl,
          sitemapPageUrls,
          robots: robotsResult.robots,
          pages,
          failures,
        });

  return {
    ok: pages.length > 0,
    error: pages.length > 0 ? "" : buildCrawlFailureMessage(failureKind),
    startUrl,
    origin: new URL(startUrl).origin,
    domain: cleanDomain(startUrl),
    discovery: {
      strategy,
      robotsUrl: robotsResult.url,
      robotsOk: robotsResult.ok,
      sitemaps: sitemapResult.sitemaps,
      sitemapFailures: sitemapResult.failures,
      pagesDiscovered: initialUrls.length,
      pagesFetched: pages.length,
      pagesFailed: failures.length,
      failureKind,
      limits: boundedLimits,
    },
    summary,
    pages,
    failures,
    events: events.slice(-80),
  };
};

export const createSiteContext = async ({ url, fetchImpl = fetch, limits = {}, onProgress }) => {
  const candidates = buildCrawlUrlCandidates(url);
  if (candidates.length === 0) {
    return { ok: false, error: "Website URL must be a valid absolute URL.", pages: [], events: [] };
  }

  onProgress?.({
    stageId: "discover",
    detail: "Checking crawl candidates",
  });

  let lastResult = null;
  let failedResults = [];
  for (const candidate of candidates) {
    const result = await createSiteContextForStartUrl({ startUrl: candidate, fetchImpl, limits, onProgress });
    if (result.ok) {
      if (candidate !== candidates[0]) {
        result.requestedStartUrl = candidates[0];
        result.events = [
          ...(result.events || []),
          {
            type: "url-fallback",
            status: "pass",
            url: candidates[0],
            detail: `Initial URL could not be crawled; used ${candidate} instead.`,
          },
        ];
      }
      return result;
    }
    lastResult = result;
    failedResults = [...failedResults, result];
  }

  const failures = failedResults.flatMap((result) => result.failures || []);
  const events = failedResults.flatMap((result) => result.events || []);
  const sitemapFailures = failedResults.flatMap((result) => result.discovery?.sitemapFailures || []);

  return {
    ...lastResult,
    attemptedUrls: candidates,
    failures,
    events: events.slice(-80),
    discovery: {
      ...(lastResult?.discovery || {}),
      sitemapFailures,
      pagesFailed: failures.length,
    },
    error: `${lastResult.error}${buildCrawlFailureHint(candidates, lastResult.discovery?.failureKind)}`,
  };
};
