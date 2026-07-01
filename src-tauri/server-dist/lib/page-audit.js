const TITLE_MIN = 15;
const TITLE_MAX = 60;
const META_MIN = 50;
const META_MAX = 160;
const MIN_INTERNAL_LINKS = 3;

const severityRank = { fail: 0, warn: 1, pass: 2 };

export const auditPage = (page) => {
  const issues = [];
  const title = String(page.title || "").trim();
  const meta = String(page.metaDescription || "").trim();
  const h1Count = page.headings?.h1?.length || (page.h1 ? 1 : 0);
  const linkCount = Array.isArray(page.links) ? page.links.length : 0;
  const images = Array.isArray(page.images) ? page.images : [];
  const imagesMissingAlt = images.filter((image) => !String(image.alt || "").trim());

  if (!title) {
    issues.push({ code: "title_missing", severity: "fail", message: "Missing page title." });
  } else if (title.length < TITLE_MIN) {
    issues.push({ code: "title_short", severity: "warn", message: `Title is short (${title.length} chars). Aim for ${TITLE_MIN}-${TITLE_MAX}.` });
  } else if (title.length > TITLE_MAX) {
    issues.push({ code: "title_long", severity: "warn", message: `Title is long (${title.length} chars). Aim for ${TITLE_MIN}-${TITLE_MAX}.` });
  }

  if (!meta) {
    issues.push({ code: "meta_missing", severity: "fail", message: "Missing meta description." });
  } else if (meta.length < META_MIN) {
    issues.push({ code: "meta_short", severity: "warn", message: `Meta description is short (${meta.length} chars).` });
  } else if (meta.length > META_MAX) {
    issues.push({ code: "meta_long", severity: "warn", message: `Meta description is long (${meta.length} chars).` });
  }

  if (h1Count === 0) {
    issues.push({ code: "h1_missing", severity: "fail", message: "Missing H1 heading." });
  } else if (h1Count > 1) {
    issues.push({ code: "h1_multiple", severity: "warn", message: `Multiple H1 headings detected (${h1Count}).` });
  }

  if (!page.canonicalUrl) {
    issues.push({ code: "canonical_missing", severity: "warn", message: "Missing canonical URL." });
  } else if (page.url && page.canonicalUrl) {
    try {
      const pageOrigin = new URL(page.url).origin;
      const canonicalOrigin = new URL(page.canonicalUrl).origin;
      if (pageOrigin.replace(/^http:/, "https:") !== canonicalOrigin.replace(/^http:/, "https:")) {
        issues.push({ code: "canonical_scheme", severity: "warn", message: "Canonical URL uses a different scheme or host." });
      }
    } catch {
      issues.push({ code: "canonical_invalid", severity: "warn", message: "Canonical URL could not be parsed." });
    }
  }

  if (imagesMissingAlt.length > 0) {
    issues.push({
      code: "image_alt_missing",
      severity: "warn",
      message: `${imagesMissingAlt.length} image(s) missing alt text.`,
    });
  }

  if (["home", "product", "pricing"].includes(page.pageType) && linkCount < MIN_INTERNAL_LINKS) {
    issues.push({
      code: "internal_links_low",
      severity: "warn",
      message: `Only ${linkCount} internal links on a core page. Aim for at least ${MIN_INTERNAL_LINKS}.`,
    });
  }

  return {
    url: page.url,
    pageType: page.pageType || "page",
    title: title || page.h1 || page.url,
    issueCount: issues.length,
    issues,
  };
};

const findDuplicates = (pages, field) => {
  const counts = new Map();
  for (const page of pages) {
    const value = String(page[field] || "").trim().toLowerCase();
    if (!value) continue;
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts.entries()].filter(([, count]) => count > 1).map(([value, count]) => ({ value, count }));
};

export const auditSitePages = (siteContext) => {
  const pages = Array.isArray(siteContext?.pages) ? siteContext.pages : [];
  const discovery = siteContext?.discovery || {};
  const pageAudits = pages.map((page) => auditPage(page));
  const siteIssues = [];

  if (!discovery.robotsOk) {
    siteIssues.push({
      code: "robots_missing",
      severity: "warn",
      message: "robots.txt was not found or could not be loaded.",
    });
  }

  if (!Array.isArray(discovery.sitemaps) || discovery.sitemaps.length === 0) {
    siteIssues.push({
      code: "sitemap_missing",
      severity: "warn",
      message: "No sitemap URL was discovered.",
    });
  }

  const duplicateTitles = findDuplicates(pages, "title");
  if (duplicateTitles.length > 0) {
    siteIssues.push({
      code: "duplicate_titles",
      severity: "warn",
      message: `${duplicateTitles.length} duplicate title group(s) across crawled pages.`,
      detail: duplicateTitles.slice(0, 3).map((item) => `"${item.value}" (${item.count}x)`).join(", "),
    });
  }

  const duplicateMetas = findDuplicates(pages, "metaDescription");
  if (duplicateMetas.length > 0) {
    siteIssues.push({
      code: "duplicate_meta",
      severity: "warn",
      message: `${duplicateMetas.length} duplicate meta description group(s) across crawled pages.`,
      detail: duplicateMetas.slice(0, 2).map((item) => `"${item.value.slice(0, 60)}..." (${item.count}x)`).join(", "),
    });
  }

  const httpPages = pages.filter((page) => String(page.url || "").startsWith("http://"));
  if (httpPages.length > 0) {
    siteIssues.push({
      code: "http_not_https",
      severity: "fail",
      message: `${httpPages.length} crawled page(s) use HTTP instead of HTTPS.`,
    });
  }

  const issueCounts = pageAudits.reduce(
    (acc, audit) => {
      for (const issue of audit.issues) {
        acc[issue.severity] = (acc[issue.severity] || 0) + 1;
      }
      return acc;
    },
    { fail: 0, warn: 0 },
  );

  for (const issue of siteIssues) {
    issueCounts[issue.severity] = (issueCounts[issue.severity] || 0) + 1;
  }

  const pagesWithIssues = pageAudits.filter((audit) => audit.issueCount > 0).length;
  const topIssues = [...pageAudits]
    .sort((left, right) => right.issueCount - left.issueCount || left.url.localeCompare(right.url))
    .slice(0, 12);

  return {
    ok: pages.length > 0,
    pagesAudited: pages.length,
    pagesWithIssues,
    issueCounts,
    siteIssues,
    pageAudits,
    topIssues,
  };
};

export const worstSeverity = (issues = []) =>
  issues.reduce((worst, issue) => (severityRank[issue.severity] < severityRank[worst] ? issue.severity : worst), "pass");
