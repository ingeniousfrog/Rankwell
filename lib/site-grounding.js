const LOCALE_PATH = /\/(zh-cn|es-es|fr-fr|de-de|ja-jp|ko-kr|pt-br)\b/i;

export const isHomepageUrl = (pageUrl, siteContext) => {
  try {
    const url = new URL(pageUrl);
    const start = new URL(siteContext?.startUrl || pageUrl);
    return url.origin === start.origin && (url.pathname === "/" || url.pathname === "");
  } catch {
    return false;
  }
};

export const findHomepageFailure = (siteContext) => {
  const failures = Array.isArray(siteContext?.failures) ? siteContext.failures : [];
  return failures.find((failure) => isHomepageUrl(failure.url, siteContext)) || null;
};

export const homepageWasCrawled = (siteContext) =>
  (siteContext?.pages || []).some((page) => page.pageType === "home" || isHomepageUrl(page.url, siteContext));

export const pageWasCrawled = (pageUrl, siteContext) =>
  (siteContext?.pages || []).some((page) => page.url === pageUrl);

export const scoreProductPage = (page) => {
  const text = `${page.url} ${page.title || ""} ${page.h1 || ""}`.toLowerCase();
  let score = 0;
  if (page.pageType === "product") score += 6;
  if (page.pageType === "home") score += 5;
  if (/lip.?sync|lipsync|talking.?head|avatar|video.?generator|voice|dubbing/i.test(text)) score += 8;
  if (/generator|workflow|script-to-video|image-to-video/i.test(text)) score += 4;
  if (page.pageType === "pricing") score += 2;
  if (LOCALE_PATH.test(page.url)) score -= 4;
  if (/\/(about|contact|terms|privacy|faq)\b/i.test(page.url)) score -= 5;
  return score;
};

export const resolveCoreProductPages = (siteContext, limit = 5) => {
  const pages = Array.isArray(siteContext?.pages) ? siteContext.pages : [];
  return pages
    .map((page) => ({ page, score: scoreProductPage(page) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.page.url.localeCompare(right.page.url))
    .slice(0, limit)
    .map((entry) => entry.page);
};

export const resolvePrimaryGroundingPage = (siteContext) => {
  if (homepageWasCrawled(siteContext)) {
    return (
      (siteContext?.pages || []).find((page) => page.pageType === "home") ||
      (siteContext?.pages || []).find((page) => isHomepageUrl(page.url, siteContext)) ||
      null
    );
  }
  return resolveCoreProductPages(siteContext, 1)[0] || (siteContext?.pages || [])[0] || null;
};

export const buildCrawlGapSummary = (siteContext) => {
  const homepageFailure = findHomepageFailure(siteContext);
  const homepageAvailable = homepageWasCrawled(siteContext);
  const recommendedGroundingPages = resolveCoreProductPages(siteContext, 4).map((page) => ({
    url: page.url,
    title: page.title || page.h1 || page.url,
    pageType: page.pageType || "page",
  }));
  const gaps = [];

  if (homepageFailure && !homepageAvailable) {
    gaps.push(
      `Homepage returned ${homepageFailure.reason || "an HTTP error"} during crawl. Use a product landing page from recommendedGroundingPages instead of the homepage.`,
    );
  } else if (!homepageAvailable && (siteContext?.pages || []).length > 0) {
    gaps.push("Homepage copy was not captured; grounding should use product landing pages below.");
  }

  return {
    homepageAvailable,
    homepageFailure: homepageFailure
      ? { url: homepageFailure.url, reason: homepageFailure.reason || "Fetch failed" }
      : null,
    recommendedGroundingPages,
    gaps,
  };
};

export const buildHomepageGapRefreshCandidates = (siteContext, options = {}) => {
  const homepageFailure = findHomepageFailure(siteContext);
  if (!homepageFailure || homepageWasCrawled(siteContext)) return [];

  const limit = options.limit ?? 3;
  return resolveCoreProductPages(siteContext, limit).map((page) => ({
    url: page.url,
    title: page.title || page.h1 || page.url,
    pageType: page.pageType || "page",
    lastmod: page.sitemapLastmod || "",
    reasons: [
      `Homepage returned ${homepageFailure.reason || "HTTP error"} during crawl.`,
      "Use this crawled product page for core keyword messaging instead of the unavailable homepage.",
    ],
    priority: "high",
  }));
};
