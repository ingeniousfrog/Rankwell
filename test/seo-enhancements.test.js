import assert from "node:assert/strict";
import test from "node:test";

import { evaluateChecklist, groupChecklistByCategory } from "../client/checklist-taxonomy.js";
import { createFallbackWorkflow } from "../client/fallback-workflow.js";
import { normalizeWorkflow } from "../client/workflow-normalize.js";
import { auditPage, auditSitePages } from "../lib/page-audit.js";
import { buildRefreshCandidates } from "../lib/refresh-candidates.js";
import { parseSitemapXml } from "../lib/site-discovery.js";

test("parseSitemapXml extracts lastmod metadata for page URLs", () => {
  const parsed = parseSitemapXml(
    `<?xml version="1.0"?><urlset>
      <url><loc>https://example.com/blog/old-post</loc><lastmod>2023-05-01</lastmod></url>
      <url><loc>https://example.com/pricing</loc><lastmod>2026-01-10</lastmod></url>
    </urlset>`,
    "https://example.com/",
  );

  assert.equal(parsed.urls.length, 2);
  assert.equal(parsed.urlMeta["https://example.com/blog/old-post"].lastmod, "2023-05-01");
});

test("auditPage flags missing meta and weak internal links on core pages", () => {
  const audit = auditPage({
    url: "https://example.com/",
    pageType: "home",
    title: "Home",
    metaDescription: "",
    h1: "Home",
    headings: { h1: ["Home"], h2: [] },
    links: ["/pricing"],
    images: [{ url: "https://example.com/hero.png", alt: "" }],
  });

  assert.ok(audit.issues.some((issue) => issue.code === "meta_missing"));
  assert.ok(audit.issues.some((issue) => issue.code === "internal_links_low"));
  assert.ok(audit.issues.some((issue) => issue.code === "image_alt_missing"));
});

test("auditSitePages reports site-level robots and sitemap gaps", () => {
  const audit = auditSitePages({
    discovery: { robotsOk: false, sitemaps: [] },
    pages: [
      {
        url: "https://example.com/",
        pageType: "home",
        title: "Home",
        metaDescription: "Welcome",
        h1: "Home",
        headings: { h1: ["Home"] },
        links: ["https://example.com/a", "https://example.com/b", "https://example.com/c"],
        images: [],
        canonicalUrl: "https://example.com/",
      },
    ],
  });

  assert.equal(audit.siteIssues.some((issue) => issue.code === "robots_missing"), true);
  assert.equal(audit.siteIssues.some((issue) => issue.code === "sitemap_missing"), true);
});

test("buildRefreshCandidates flags stale sitemap lastmod and dated titles", () => {
  const candidates = buildRefreshCandidates(
    {
      pages: [
        {
          url: "https://example.com/blog/old",
          title: "Best SEO tools 2023",
          pageType: "blog",
          sitemapLastmod: "2023-04-01",
        },
        {
          url: "https://example.com/pricing",
          title: "Pricing",
          pageType: "pricing",
          sitemapLastmod: "2026-02-01",
        },
      ],
    },
    { now: Date.parse("2026-06-30") },
  );

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].url, "https://example.com/blog/old");
  assert.equal(candidates[0].priority, "high");
});

test("fallback workflow includes question keywords, schema suggestion, and grouped checklist source", () => {
  const workflow = createFallbackWorkflow(
    { url: "https://example.com/", domain: "example.com", includeDraft: true },
    {
      ok: true,
      pages: [
        {
          url: "https://example.com/",
          pageType: "home",
          title: "Example",
          metaDescription: "Example site",
          h1: "Example",
          pageText: "Example",
        },
      ],
      summary: { pageCount: 1, pageTypes: { home: 1 } },
      discovery: { robotsOk: true, sitemaps: ["https://example.com/sitemap.xml"] },
    },
  );

  assert.ok(workflow.keywords[0].questionVariants?.length >= 2);
  assert.ok(workflow.drafts[0].schemaSuggestion?.type);
  assert.equal(typeof workflow.checklist[0], "object");
  assert.ok(Array.isArray(workflow.strategy.refreshCandidates));
});

test("normalizeWorkflow preserves structured checklist and refresh candidates", () => {
  const workflow = normalizeWorkflow(createFallbackWorkflow({ url: "https://example.com/", domain: "example.com" }), {
    url: "https://example.com/",
    domain: "example.com",
  });

  assert.equal(typeof workflow.checklist[0], "object");
  assert.ok(workflow.checklist[0].category);
  assert.ok(Array.isArray(workflow.strategy.refreshCandidates));
});

test("evaluateChecklist groups auto and manual items across search categories", () => {
  const workflow = normalizeWorkflow(createFallbackWorkflow({ url: "https://example.com/", domain: "example.com" }), {
    url: "https://example.com/",
    domain: "example.com",
  });
  const evaluated = evaluateChecklist(workflow);
  const groups = groupChecklistByCategory(evaluated);

  assert.ok(groups.length >= 6);
  assert.ok(evaluated.some((item) => item.kind === "auto"));
  assert.ok(evaluated.some((item) => item.kind === "manual"));
});

test("evaluateChecklist respects requested content plan length", () => {
  const workflow = normalizeWorkflow(
    createFallbackWorkflow({ url: "https://example.com/", domain: "example.com", planLength: 5 }),
    { url: "https://example.com/", domain: "example.com", planLength: 5 },
  );
  const evaluated = evaluateChecklist(workflow);
  const calendarReady = evaluated.find((item) => item.autoKey === "calendarReady");

  assert.equal(workflow.calendar.length, 5);
  assert.equal(calendarReady?.status, "pass");
});
