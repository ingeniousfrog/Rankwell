import assert from "node:assert/strict";
import test from "node:test";

import { buildOpportunityBackedPlan, normalizePlanItem } from "../lib/opportunity-plan.js";

const siteContext = {
  ok: true,
  startUrl: "https://example.com/",
  domain: "example.com",
  pages: [
    {
      url: "https://example.com/blog/content-brief",
      pageType: "blog",
      title: "Content Brief Workflow",
      h1: "How to build content briefs",
    },
    {
      url: "https://example.com/features/planner",
      pageType: "product",
      title: "SEO Planner",
      h1: "SEO content planner",
    },
  ],
};

const inputs = {
  url: "https://example.com/",
  domain: "example.com",
  category: "SEO content planner",
  audience: "marketers",
  goal: "publish better pages",
  planLength: 5,
};

const fallbackCalendar = [
  {
    day: 1,
    title: "How to build a content plan",
    keyword: "content plan",
    intent: "Problem",
    format: "guide",
    placement: "blog",
  },
  {
    day: 2,
    title: "SEO brief examples for teams",
    keyword: "seo brief examples",
    intent: "Education",
    format: "guide",
    placement: "blog",
  },
];

const opportunityBase = {
  source: "google-search-console",
  priority: "high",
  recommendedActions: ["Use the exact query in the title.", "Add FAQ coverage."],
};

test("buildOpportunityBackedPlan maps GSC opportunities into task-specific plan items", () => {
  const plan = buildOpportunityBackedPlan({
    opportunities: [
      {
        ...opportunityBase,
        type: "refresh",
        title: 'Refresh page for "content brief template"',
        query: "content brief template",
        page: "https://example.com/blog/content-brief",
        metrics: { clicks: 8, impressions: 800, ctr: 0.01, position: 12.4 },
      },
      {
        ...opportunityBase,
        type: "expand",
        title: "Expand Content Brief Workflow",
        query: "content brief",
        page: "https://example.com/blog/content-brief",
        metrics: { clicks: 21, impressions: 1580, ctr: 0.0133, position: 14.2 },
        queries: [
          { query: "content brief template", impressions: 800 },
          { query: "content brief example", impressions: 520 },
          { query: "content brief checklist", impressions: 260 },
        ],
      },
      {
        ...opportunityBase,
        type: "newPage",
        title: 'Create landing page for "content planner alternatives"',
        query: "content planner alternatives",
        page: "",
        metrics: { clicks: 2, impressions: 620, ctr: 0.0032, position: 42.5 },
      },
      {
        ...opportunityBase,
        type: "cannibalization",
        title: 'Resolve split ranking for "seo content planner"',
        query: "seo content planner",
        urls: ["https://example.com/features/planner", "https://example.com/blog/seo-content-planner"],
        metrics: { clicks: 23, impressions: 1380, ctr: 0.0167, position: 10.4 },
        queries: [
          { query: "seo content planner", page: "https://example.com/features/planner", impressions: 700 },
          { query: "seo content planner", page: "https://example.com/blog/seo-content-planner", impressions: 680 },
        ],
      },
    ],
    fallbackCalendar,
    planLength: 5,
    siteContext,
    inputs,
  });

  assert.equal(plan.length, 5);
  assert.deepEqual(
    plan.slice(0, 4).map((item) => [item.opportunityType, item.draftMode, item.isDraftable]),
    [
      ["refresh", "refreshBrief", true],
      ["expand", "expandBrief", true],
      ["newPage", "newPageDraft", true],
      ["cannibalization", "governance", false],
    ],
  );
  assert.equal(plan[0].targetUrl, "https://example.com/blog/content-brief");
  assert.equal(plan[0].opportunityMetrics.impressions, 800);
  assert.equal(plan[1].targetUrl, "https://example.com/blog/content-brief");
  assert.deepEqual(plan[1].queries.map((item) => item.query), [
    "content brief template",
    "content brief example",
    "content brief checklist",
  ]);
  assert.match(plan[2].targetUrl, /^https:\/\/example\.com\/compare\/content-planner-alternatives/);
  assert.equal(plan[3].targetUrl, "https://example.com/features/planner");
  assert.ok(plan.every((item) => item.id));
  assert.ok(plan.slice(0, 4).every((item) => item.sourceOpportunityId));
  assert.equal(plan[4].opportunityType, "crawlFallback");
  assert.equal(plan[4].draftMode, "newPageDraft");
});

test("normalizePlanItem upgrades legacy calendar items without pretending they have GSC data", () => {
  const item = normalizePlanItem(fallbackCalendar[0], {
    index: 0,
    inputs,
    siteContext,
  });

  assert.equal(item.opportunityType, "crawlFallback");
  assert.equal(item.draftMode, "newPageDraft");
  assert.equal(item.isDraftable, true);
  assert.equal(item.sourceOpportunityId, "");
  assert.deepEqual(item.opportunityMetrics, {
    clicks: 0,
    impressions: 0,
    ctr: 0,
    position: 0,
  });
});

test("opportunity-backed plan keeps refresh expand and governance out of the new-page draft path", () => {
  const plan = buildOpportunityBackedPlan({
    opportunities: [
      {
        type: "refresh",
        query: "content brief template",
        page: "https://example.com/blog/content-brief",
      },
      {
        type: "expand",
        query: "content brief",
        page: "https://example.com/blog/content-brief",
      },
      {
        type: "cannibalization",
        query: "seo content planner",
        urls: ["https://example.com/features/planner", "https://example.com/blog/seo-content-planner"],
      },
    ],
    fallbackCalendar: [],
    planLength: 3,
    siteContext,
    inputs,
  });

  assert.deepEqual(
    plan.map((item) => item.draftMode),
    ["refreshBrief", "expandBrief", "governance"],
  );
  assert.equal(plan.filter((item) => item.draftMode === "newPageDraft").length, 0);
});
