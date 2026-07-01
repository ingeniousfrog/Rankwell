import assert from "node:assert/strict";
import test from "node:test";

import { normalizeWorkflow } from "../client/workflow-normalize.js";
import {
  buildSeoOpportunities,
  normalizeOpportunity,
  normalizeSearchAnalyticsRows,
} from "../lib/seo-opportunities.js";

const siteContext = {
  ok: true,
  startUrl: "https://example.com/",
  domain: "example.com",
  pages: [
    {
      url: "https://example.com/",
      pageType: "home",
      title: "Example Content Platform",
      h1: "Plan better content",
      pageText: "Plan article workflows and editorial briefs for teams.",
    },
    {
      url: "https://example.com/blog/content-brief",
      pageType: "blog",
      title: "Content Brief Workflow",
      h1: "How to build content briefs",
      pageText: "A workflow for content briefs, approvals, and publishing. Missing examples and templates.",
    },
    {
      url: "https://example.com/features/planner",
      pageType: "product",
      title: "SEO Planner",
      h1: "SEO content planner",
      pageText: "Plan SEO content from website evidence.",
    },
    {
      url: "https://example.com/blog/seo-content-planner",
      pageType: "blog",
      title: "SEO Content Planner Guide",
      h1: "SEO content planner",
      pageText: "A guide to planning SEO content.",
    },
  ],
  summary: { pageCount: 4, pageTypes: { home: 1, blog: 2, product: 1 } },
  discovery: { robotsOk: true, sitemaps: ["https://example.com/sitemap.xml"] },
};

test("normalizeSearchAnalyticsRows maps GSC keys into query/page metrics", () => {
  const rows = normalizeSearchAnalyticsRows(
    [
      {
        keys: ["content brief template", "https://example.com/blog/content-brief", "USA", "DESKTOP"],
        clicks: 8,
        impressions: 800,
        ctr: 0.01,
        position: 12.4,
      },
    ],
    ["query", "page", "country", "device"],
  );

  assert.deepEqual(rows, [
    {
      query: "content brief template",
      page: "https://example.com/blog/content-brief",
      country: "USA",
      device: "DESKTOP",
      clicks: 8,
      impressions: 800,
      ctr: 0.01,
      position: 12.4,
    },
  ]);
});

test("buildSeoOpportunities creates refresh tasks from low-CTR ranking queries", () => {
  const result = buildSeoOpportunities({
    siteContext,
    performanceRows: [
      {
        query: "content brief template",
        page: "https://example.com/blog/content-brief",
        clicks: 8,
        impressions: 800,
        ctr: 0.01,
        position: 12.4,
      },
    ],
  });

  const refresh = result.items.find((item) => item.type === "refresh");
  assert.equal(refresh.page, "https://example.com/blog/content-brief");
  assert.equal(refresh.query, "content brief template");
  assert.equal(refresh.metrics.impressions, 800);
  assert.ok(refresh.recommendedActions.some((action) => /title/i.test(action)));
  assert.ok(refresh.recommendedActions.some((action) => /FAQ|internal link/i.test(action)));
});

test("buildSeoOpportunities creates expand tasks for related long-tail clusters on one page", () => {
  const result = buildSeoOpportunities({
    siteContext,
    performanceRows: [
      {
        query: "content brief template",
        page: "https://example.com/blog/content-brief",
        clicks: 8,
        impressions: 800,
        ctr: 0.01,
        position: 12.4,
      },
      {
        query: "content brief example",
        page: "https://example.com/blog/content-brief",
        clicks: 10,
        impressions: 520,
        ctr: 0.019,
        position: 14.2,
      },
      {
        query: "content brief checklist",
        page: "https://example.com/blog/content-brief",
        clicks: 3,
        impressions: 260,
        ctr: 0.012,
        position: 17.8,
      },
    ],
  });

  const expand = result.items.find((item) => item.type === "expand");
  assert.equal(expand.page, "https://example.com/blog/content-brief");
  assert.deepEqual(
    expand.queries.map((item) => item.query),
    ["content brief template", "content brief example", "content brief checklist"],
  );
  assert.ok(expand.recommendedActions.some((action) => /subsection/i.test(action)));
});

test("buildSeoOpportunities creates new-page tasks when demand has no suitable landing page", () => {
  const result = buildSeoOpportunities({
    siteContext,
    performanceRows: [
      {
        query: "content planner alternatives",
        page: "https://example.com/",
        clicks: 2,
        impressions: 620,
        ctr: 0.0032,
        position: 42.5,
      },
    ],
  });

  const newPage = result.items.find((item) => item.type === "newPage");
  assert.equal(newPage.query, "content planner alternatives");
  assert.equal(newPage.page, "");
  assert.ok(newPage.reason.includes("No crawled page"));
  assert.ok(newPage.recommendedActions.some((action) => /new page/i.test(action)));
});

test("buildSeoOpportunities creates cannibalization tasks for one query split across URLs", () => {
  const result = buildSeoOpportunities({
    siteContext,
    performanceRows: [
      {
        query: "seo content planner",
        page: "https://example.com/features/planner",
        clicks: 14,
        impressions: 700,
        ctr: 0.02,
        position: 9.2,
      },
      {
        query: "seo content planner",
        page: "https://example.com/blog/seo-content-planner",
        clicks: 9,
        impressions: 680,
        ctr: 0.013,
        position: 11.7,
      },
    ],
  });

  const cannibalization = result.items.find((item) => item.type === "cannibalization");
  assert.equal(cannibalization.query, "seo content planner");
  assert.deepEqual(cannibalization.urls, [
    "https://example.com/features/planner",
    "https://example.com/blog/seo-content-planner",
  ]);
  assert.ok(cannibalization.recommendedActions.some((action) => /canonical|redirect/i.test(action)));
});

test("normalizeWorkflow preserves GSC opportunity evidence", () => {
  const opportunity = normalizeOpportunity({
    type: "refresh",
    title: "Refresh content brief template",
    query: "content brief template",
    page: "https://example.com/blog/content-brief",
    metrics: { clicks: 8, impressions: 800, ctr: 0.01, position: 12.4 },
    recommendedActions: ["Rewrite title"],
  });
  const workflow = normalizeWorkflow(
    {
      inputs: { url: "https://example.com/", domain: "example.com" },
      strategy: { opportunities: [opportunity] },
      keywords: [],
      calendar: [],
      drafts: [],
      checklist: [],
      siteContext,
      gscPerformance: {
        status: "connected",
        propertyUrl: "https://example.com/",
        rowCount: 1,
      },
    },
    { url: "https://example.com/", domain: "example.com" },
  );

  assert.equal(workflow.strategy.opportunities[0].source, "google-search-console");
  assert.equal(workflow.gscPerformance.status, "connected");
});
