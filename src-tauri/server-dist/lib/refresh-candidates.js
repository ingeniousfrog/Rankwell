import { buildHomepageGapRefreshCandidates } from "./site-grounding.js";

const TWELVE_MONTHS_MS = 365 * 24 * 60 * 60 * 1000;
const STALE_YEAR_PATTERN = /\b20(1[0-9]|2[0-4])\b/;

const parseDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const currentYear = () => new Date().getFullYear();

export const inferRefreshReason = (page, now = Date.now()) => {
  const reasons = [];
  const lastmod = parseDate(page.sitemapLastmod);
  if (lastmod && now - lastmod.getTime() > TWELVE_MONTHS_MS) {
    reasons.push(`Sitemap lastmod is older than 12 months (${lastmod.toISOString().slice(0, 10)}).`);
  }

  const title = `${page.title || ""} ${page.h1 || ""}`;
  const yearMatch = title.match(STALE_YEAR_PATTERN);
  if (yearMatch) {
    const year = Number(yearMatch[0]);
    if (year < currentYear() - 1) {
      reasons.push(`Title references ${year}; consider updating for ${currentYear()}.`);
    }
  }

  if (page.pageType === "blog" && !lastmod && (page.wordCount || 0) > 0) {
    reasons.push("Blog page has no sitemap lastmod signal; verify freshness manually.");
  }

  return reasons;
};

export const buildRefreshCandidates = (siteContext, options = {}) => {
  const pages = Array.isArray(siteContext?.pages) ? siteContext.pages : [];
  const now = options.now ?? Date.now();
  const limit = options.limit ?? 12;

  const staleCandidates = pages
    .map((page) => {
      const reasons = inferRefreshReason(page, now);
      if (reasons.length === 0) return null;
      return {
        url: page.url,
        title: page.title || page.h1 || page.url,
        pageType: page.pageType || "page",
        lastmod: page.sitemapLastmod || "",
        reasons,
        priority: reasons.some((reason) => reason.includes("lastmod")) ? "high" : "medium",
      };
    })
    .filter(Boolean);

  const gapCandidates = buildHomepageGapRefreshCandidates(siteContext, { limit: 3 });
  const seen = new Set();
  return [...gapCandidates, ...staleCandidates]
    .filter((candidate) => {
      if (!candidate?.url || seen.has(candidate.url)) return false;
      seen.add(candidate.url);
      return true;
    })
    .sort((left, right) => {
      const priorityRank = { high: 0, medium: 1 };
      return priorityRank[left.priority] - priorityRank[right.priority] || left.title.localeCompare(right.title);
    })
    .slice(0, limit);
};
