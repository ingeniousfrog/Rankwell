import assert from "node:assert/strict";
import test from "node:test";

import {
  DRAFT_REQUEST_MAX_BYTES,
  buildDraftRequestPayload,
  compactCalendarItemForDraft,
} from "../client/draft-request.js";

test("compactCalendarItemForDraft keeps only draft-critical opportunity fields", () => {
  const compact = compactCalendarItemForDraft({
    id: "plan-refresh-1",
    day: 1,
    title: "Refresh content brief template",
    keyword: "content brief template",
    intent: "Refresh",
    format: "refresh brief",
    placement: "existing page",
    placementUrl: "https://example.com/blog/content-brief",
    targetUrl: "https://example.com/blog/content-brief",
    opportunityType: "refresh",
    draftMode: "refreshBrief",
    isDraftable: true,
    sourceOpportunityId: "opp-refresh-1",
    opportunityMetrics: { clicks: 8, impressions: 800, ctr: 0.01, position: 12.4 },
    recommendedActions: ["Rewrite title", "Add paragraph", "Add FAQ", "Add internal links"],
    queries: Array.from({ length: 9 }, (_, index) => ({ query: `query ${index}`, impressions: index })),
    urls: Array.from({ length: 9 }, (_, index) => `https://example.com/page-${index}`),
    siteContext: { pages: [{ pageText: "x".repeat(10_000) }] },
    oversizedNotes: "x".repeat(10_000),
  });

  assert.equal(compact.id, "plan-refresh-1");
  assert.equal(compact.draftMode, "refreshBrief");
  assert.equal(compact.targetUrl, "https://example.com/blog/content-brief");
  assert.deepEqual(compact.opportunityMetrics, { clicks: 8, impressions: 800, ctr: 0.01, position: 12.4 });
  assert.equal(compact.queries.length, 5);
  assert.equal(compact.urls.length, 5);
  assert.equal("siteContext" in compact, false);
  assert.equal("oversizedNotes" in compact, false);
});

test("buildDraftRequestPayload excludes siteContext and reports payload byte size", () => {
  const payload = buildDraftRequestPayload({
    input: {
      url: "https://example.com/",
      domain: "example.com",
      siteContext: { pages: [{ pageText: "x".repeat(30_000) }] },
    },
    calendarItem: {
      id: "plan-new-1",
      title: "Content planner alternatives",
      keyword: "content planner alternatives",
      draftMode: "newPageDraft",
      opportunityType: "newPage",
    },
    existingTitles: ["Old title"],
  });

  assert.ok(payload.bytes < DRAFT_REQUEST_MAX_BYTES);
  assert.equal("siteContext" in payload.body, false);
  assert.equal("siteContext" in payload.body.input, false);
  assert.equal("siteContext" in payload.body.calendarItem, false);
  assert.equal(payload.body.calendarItem.id, "plan-new-1");
});

test("buildDraftRequestPayload blocks oversized compact requests before fetch", () => {
  assert.throws(
    () =>
      buildDraftRequestPayload({
        input: {
          url: "https://example.com/",
          domain: "example.com",
          category: "x".repeat(DRAFT_REQUEST_MAX_BYTES),
        },
        calendarItem: {
          id: "plan-new-1",
          title: "Content planner alternatives",
          keyword: "content planner alternatives",
          draftMode: "newPageDraft",
          opportunityType: "newPage",
        },
        existingTitles: [],
      }),
    /too large/i,
  );
});
