import { auditSitePages } from "../lib/page-audit.js";
import { normalizePlanLength } from "../lib/plan-length.js";

export const CHECKLIST_CATEGORY_LABELS = {
  seoBasics: "Search Setup",
  keywordResearch: "Search Themes",
  onPage: "Page Quality",
  offPage: "Authority Signals",
  content: "Content Plan",
  technical: "Technical Health",
};

export const checklistItems = [
  {
    category: "seoBasics",
    kind: "auto",
    autoKey: "robotsOk",
    item: "robots.txt is reachable and readable.",
  },
  {
    category: "seoBasics",
    kind: "auto",
    autoKey: "sitemapFound",
    item: "XML sitemap is discoverable from robots.txt or default paths.",
  },
  {
    category: "seoBasics",
    kind: "manual",
    item: "Google Search Console is set up and the sitemap is submitted.",
    link: "https://search.google.com/search-console",
  },
  {
    category: "seoBasics",
    kind: "manual",
    item: "Google Analytics or another analytics tool is installed.",
    link: "https://analytics.google.com/",
  },
  {
    category: "keywordResearch",
    kind: "auto",
    autoKey: "keywordsReady",
    item: "Primary and long-tail search themes are ranked in the workspace.",
  },
  {
    category: "keywordResearch",
    kind: "auto",
    autoKey: "questionKeywords",
    item: "Question-style keyword variants are captured for FAQ and snippet opportunities.",
  },
  {
    category: "keywordResearch",
    kind: "manual",
    item: "Competitor search gaps are reviewed in Ahrefs, Semrush, or similar.",
    link: "https://ahrefs.com/",
  },
  {
    category: "onPage",
    kind: "auto",
    autoKey: "metaCoverage",
    item: "Crawled pages have unique titles and meta descriptions.",
  },
  {
    category: "onPage",
    kind: "auto",
    autoKey: "headingStructure",
    item: "Core pages have a single clear H1 and supporting headings.",
  },
  {
    category: "onPage",
    kind: "manual",
    item: "Target search phrase appears in title, intro, one H2, and meta description for each new draft.",
  },
  {
    category: "onPage",
    kind: "manual",
    item: "Schema markup is added for Article, FAQ, or HowTo where appropriate.",
  },
  {
    category: "offPage",
    kind: "manual",
    item: "Unlinked brand mentions are turned into backlinks or outreach targets.",
  },
  {
    category: "offPage",
    kind: "manual",
    item: "Competitor backlink profiles are analyzed for realistic link opportunities.",
    link: "https://ahrefs.com/",
  },
  {
    category: "offPage",
    kind: "manual",
    item: "Google Business Profile is claimed if local discovery matters.",
    link: "https://business.google.com/",
  },
  {
    category: "content",
    kind: "auto",
    autoKey: "calendarReady",
    item: "The content plan maps topics to placement targets.",
  },
  {
    category: "content",
    kind: "manual",
    item: "Draft intro states search intent in the first two paragraphs.",
  },
  {
    category: "content",
    kind: "manual",
    item: "Draft connects claims to website evidence instead of generic marketing copy.",
  },
  {
    category: "content",
    kind: "auto",
    autoKey: "refreshQueue",
    item: "Stale pages are flagged for refresh before net-new planning.",
  },
  {
    category: "technical",
    kind: "auto",
    autoKey: "httpsConsistent",
    item: "Site URLs use HTTPS consistently.",
  },
  {
    category: "technical",
    kind: "auto",
    autoKey: "canonicalCoverage",
    item: "Canonical tags are present on crawled core pages.",
  },
  {
    category: "technical",
    kind: "manual",
    item: "Core Web Vitals and mobile usability are checked in PageSpeed Insights.",
    link: "https://pagespeed.web.dev/",
  },
  {
    category: "technical",
    kind: "manual",
    item: "Broken links and crawl errors are reviewed before changes are exported.",
  },
];

const autoEvaluators = {
  robotsOk: (ctx) => Boolean(ctx.discovery?.robotsOk),
  sitemapFound: (ctx) => Array.isArray(ctx.discovery?.sitemaps) && ctx.discovery.sitemaps.length > 0,
  keywordsReady: (ctx) => Array.isArray(ctx.workflow?.keywords) && ctx.workflow.keywords.length >= 3,
  questionKeywords: (ctx) =>
    Array.isArray(ctx.workflow?.keywords) &&
    ctx.workflow.keywords.some((keyword) => Array.isArray(keyword.questionVariants) && keyword.questionVariants.length > 0),
  metaCoverage: (ctx) => {
    const pages = ctx.audit?.pageAudits || [];
    if (pages.length === 0) return false;
    const missing = pages.filter((audit) => audit.issues.some((issue) => issue.code.startsWith("meta_") || issue.code.startsWith("title_")));
    return missing.length === 0;
  },
  headingStructure: (ctx) => {
    const pages = ctx.audit?.pageAudits || [];
    if (pages.length === 0) return false;
    const bad = pages.filter((audit) => audit.issues.some((issue) => issue.code.startsWith("h1_")));
    return bad.length === 0;
  },
  calendarReady: (ctx) => {
    const calendar = ctx.workflow?.calendar;
    const expectedLength = normalizePlanLength(ctx.workflow?.inputs?.planLength);
    return Array.isArray(calendar) && calendar.length >= expectedLength;
  },
  refreshQueue: (ctx) => Boolean(ctx.workflow?.siteContext?.ok),
  httpsConsistent: (ctx) => !(ctx.audit?.siteIssues || []).some((issue) => issue.code === "http_not_https"),
  canonicalCoverage: (ctx) => {
    const core = (ctx.workflow?.siteContext?.pages || []).filter((page) =>
      ["home", "product", "pricing", "blog"].includes(page.pageType),
    );
    if (core.length === 0) return false;
    return core.every((page) => Boolean(page.canonicalUrl));
  },
};

export const normalizeChecklistItem = (item) => {
  if (typeof item === "string") {
    return { category: "content", kind: "manual", item };
  }
  return {
    category: item?.category && CHECKLIST_CATEGORY_LABELS[item.category] ? item.category : "content",
    kind: item?.kind === "auto" ? "auto" : "manual",
    autoKey: item?.autoKey || "",
    item: item?.item || item?.text || item?.label || "Review item",
    link: item?.link || "",
  };
};

export const evaluateChecklist = (workflow) => {
  const audit = auditSitePages(workflow?.siteContext);
  const context = {
    workflow,
    discovery: workflow?.siteContext?.discovery || {},
    audit,
  };
  const source = Array.isArray(workflow?.checklist) && workflow.checklist.length > 0 ? workflow.checklist : checklistItems;

  return source.map((raw) => {
    const item = normalizeChecklistItem(raw);
    if (item.kind !== "auto" || !item.autoKey || !autoEvaluators[item.autoKey]) {
      return { ...item, status: "manual", passed: null };
    }
    const passed = autoEvaluators[item.autoKey](context);
    return {
      ...item,
      status: passed ? "pass" : "warn",
      passed,
    };
  });
};

export const groupChecklistByCategory = (items) =>
  Object.entries(CHECKLIST_CATEGORY_LABELS).map(([category, label]) => ({
    category,
    label,
    items: items.filter((item) => item.category === category),
  }));
