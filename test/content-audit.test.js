import assert from "node:assert/strict";
import test from "node:test";

import { createFallbackWorkflow } from "../client/fallback-workflow.js";
import { normalizeWorkflow } from "../client/workflow-normalize.js";
import {
  auditCalendar,
  auditCalendarItem,
  auditContentGrounding,
  buildAudienceTitle,
  detectMetaToolLanguage,
  isInternalCalendarTitle,
} from "../lib/content-audit.js";
import { auditDraft } from "../lib/draft-templates.js";

test("isInternalCalendarTitle flags SEO-brief style headlines", () => {
  assert.equal(isInternalCalendarTitle("Why prospective buyers struggle with how to scale software product"), true);
  assert.equal(isInternalCalendarTitle("How to create lipsync videos from a script"), false);
});

test("buildAudienceTitle returns a publishable headline", () => {
  const title = buildAudienceTitle(
    { keyword: "how to scale ai video platform", intent: "Problem", format: "guide" },
    { category: "AI video creation platform", audience: "creators and marketers" },
  );
  assert.equal(isInternalCalendarTitle(title), false);
  assert.match(title, /How to/i);
});

test("auditContentGrounding fails meta tool copy and weak evidence", () => {
  const audit = auditContentGrounding(
    {
      title: "Test",
      meta: "Meta",
      sections: [
        {
          heading: "Bad",
          body: "Start with the website, not a blank prompt. Build a keyword queue and content machine.",
        },
      ],
      evidenceRefs: [{ url: "https://synclip.ai/", source: "local assumptions", usedFor: "Initial local fallback draft context." }],
    },
    { ok: false, pages: [] },
    { category: "software product" },
  );

  assert.equal(audit.hasFailures, true);
  assert.ok(audit.checks.some((check) => check.label === "Product copy" && check.status === "fail"));
  assert.ok(audit.checks.some((check) => check.label === "Site grounding" && check.status === "fail"));
});

test("detectMetaToolLanguage finds SEO tool phrases", () => {
  const hits = detectMetaToolLanguage("Turn SEO into a second full-time job with a keyword queue.");
  assert.ok(hits.length >= 2);
});

test("auditCalendarItem fails internal titles and generic keywords", () => {
  const audit = auditCalendarItem(
    {
      day: 1,
      title: "Why prospective buyers struggle with how to scale software product",
      keyword: "how to scale software product",
      placement: "blog",
    },
    { category: "software product", audience: "prospective buyers" },
    { ok: false, pages: [] },
  );

  assert.equal(audit.hasFailures, true);
  assert.ok(audit.suggestedTitle);
  assert.equal(isInternalCalendarTitle(audit.suggestedTitle), false);
});

test("auditCalendar annotates each item with qaChecks", () => {
  const result = auditCalendar(
    [
      {
        day: 1,
        title: "How to turn scripts into lipsync videos",
        keyword: "lipsync video generator",
        placement: "blog",
      },
      {
        day: 2,
        title: "Why prospective buyers struggle with software product",
        keyword: "how to scale software product",
        placement: "blog",
      },
    ],
    { category: "AI video creation platform", audience: "creators" },
    { ok: true, pages: [{ url: "https://synclip.ai/", title: "Synclip" }] },
  );

  assert.equal(result.summary.failures, 1);
  const firstTitleCheck = result.items[0].qaChecks.find((check) => check.label === "Audience title");
  assert.ok(firstTitleCheck && firstTitleCheck.status !== "fail");
  assert.ok(result.items[1].hasQaFailures);
});

test("auditDraft includes content grounding failures for fallback-style blog drafts", () => {
  const audit = auditDraft(
    {
      templateId: "blogArticle",
      placement: "blog",
      title: "Why prospective buyers struggle with how to scale software product",
      meta: "Meta",
      sections: [
        {
          heading: "The workflow that matters",
          body: "Start with the website, not a blank prompt. Extract content gaps and build a keyword queue.",
        },
        { heading: "A", body: "B" },
        { heading: "C", body: "D" },
      ],
      blocks: [],
      evidenceRefs: [{ url: "https://synclip.ai/", source: "local assumptions", usedFor: "Initial local fallback draft context." }],
      schemaSuggestion: { type: "HowTo", reason: "test" },
    },
    { keyword: "how to scale software product", placement: "blog", format: "guide" },
    { ok: false, pages: [] },
    { category: "software product", audience: "prospective buyers" },
  );

  assert.equal(audit.hasFailures, true);
  assert.ok(audit.checks.some((check) => check.label === "Product copy" && check.status === "fail"));
});

test("fallback workflow calendar uses audience-facing titles", () => {
  const workflow = createFallbackWorkflow(
    { url: "https://synclip.ai/", domain: "synclip.ai" },
    { ok: false, pages: [] },
  );

  assert.ok(workflow.calendar.every((item) => !isInternalCalendarTitle(item.title)));
  assert.ok(workflow.calendarAudit);
});

test("normalizeWorkflow attaches calendar audit summary", () => {
  const workflow = normalizeWorkflow(createFallbackWorkflow({ url: "https://synclip.ai/", domain: "synclip.ai" }), {
    url: "https://synclip.ai/",
    domain: "synclip.ai",
  });

  assert.ok(workflow.calendarAudit);
  assert.ok(workflow.calendar[0].qaChecks);
});
