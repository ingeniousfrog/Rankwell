import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCrawlGapSummary,
  buildHomepageGapRefreshCandidates,
  resolveCoreProductPages,
  resolvePrimaryGroundingPage,
} from "../lib/site-grounding.js";
import { buildRefreshCandidates } from "../lib/refresh-candidates.js";

const siteContext = {
  ok: true,
  startUrl: "https://synclip.ai/",
  pages: [
    {
      url: "https://synclip.ai/lip-sync-generator",
      title: "Lip Sync Generator — Synclip",
      pageType: "page",
    },
    {
      url: "https://synclip.ai/pricing",
      title: "Pricing — Synclip",
      pageType: "pricing",
    },
  ],
  failures: [{ url: "https://synclip.ai/", reason: "HTTP 502 text/html" }],
};

test("resolvePrimaryGroundingPage prefers product pages when homepage crawl failed", () => {
  const page = resolvePrimaryGroundingPage(siteContext);
  assert.equal(page.url, "https://synclip.ai/lip-sync-generator");
});

test("buildCrawlGapSummary flags homepage failure and recommends product pages", () => {
  const summary = buildCrawlGapSummary(siteContext);
  assert.equal(summary.homepageAvailable, false);
  assert.match(summary.gaps[0], /Homepage returned HTTP 502/i);
  assert.equal(summary.recommendedGroundingPages[0]?.url, "https://synclip.ai/lip-sync-generator");
});

test("buildHomepageGapRefreshCandidates explains using product page instead of homepage", () => {
  const candidates = buildHomepageGapRefreshCandidates(siteContext);
  assert.equal(candidates.length, 2);
  assert.match(candidates[0].reasons.join(" "), /Homepage returned HTTP 502/i);
  assert.match(candidates[0].reasons.join(" "), /instead of the unavailable homepage/i);
});

test("buildRefreshCandidates prepends homepage-gap candidates", () => {
  const candidates = buildRefreshCandidates(siteContext);
  assert.equal(candidates[0].url, "https://synclip.ai/lip-sync-generator");
});

test("resolveCoreProductPages deprioritizes locale duplicates", () => {
  const pages = resolveCoreProductPages({
    pages: [
      { url: "https://synclip.ai/zh-cn/lip-sync-generator", title: "口型同步", pageType: "page" },
      { url: "https://synclip.ai/lip-sync-generator", title: "Lip Sync Generator", pageType: "page" },
    ],
  });
  assert.equal(pages[0].url, "https://synclip.ai/lip-sync-generator");
});
