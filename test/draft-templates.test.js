import assert from "node:assert/strict";
import test from "node:test";

import { buildDraft } from "../client/fallback-workflow.js";
import { draftToMarkdown } from "../client/markdown-export.js";
import { normalizeWorkflow } from "../client/workflow-normalize.js";
import {
  auditDraft,
  resolveDraftTemplate,
  suggestPlacementUrl,
} from "../lib/draft-templates.js";
import { buildDraftPrompt } from "../lib/ai-prompts.js";

test("resolveDraftTemplate maps product placements to productPage", () => {
  const template = resolveDraftTemplate({ placement: "product page", format: "landing" });
  assert.equal(template.id, "productPage");
});

test("resolveDraftTemplate maps blog placements to blogArticle", () => {
  const template = resolveDraftTemplate({ placement: "blog", format: "guide" });
  assert.equal(template.id, "blogArticle");
});

test("suggestPlacementUrl prefers refreshing overlapping product pages", () => {
  const suggestion = suggestPlacementUrl(
    { keyword: "ai talking head video generator", placement: "product page" },
    {
      pages: [
        {
          url: "https://synclip.ai/ai-talking-head-video-generator",
          title: "AI Talking Head Video Generator",
          h1: "AI Talking Head Video Generator",
        },
      ],
    },
    { url: "https://synclip.ai/" },
  );

  assert.equal(suggestion.strategy, "refresh");
  assert.equal(suggestion.url, "https://synclip.ai/ai-talking-head-video-generator");
});

test("suggestPlacementUrl ignores object prototype token names", () => {
  const suggestion = suggestPlacementUrl(
    { keyword: "constructor workflow", placement: "blog" },
    {
      startUrl: "https://synclip.ai/",
      pages: [
        {
          url: "https://synclip.ai/constructor-workflow",
          title: "Constructor workflow",
          h1: "Constructor workflow",
        },
      ],
    },
    { url: "https://synclip.ai/" },
  );

  assert.equal(suggestion.strategy, "net-new");
  assert.equal(suggestion.url, "https://synclip.ai/blog/constructor-workflow");
});

test("auditDraft fails when product page draft uses blog sections only", () => {
  const audit = auditDraft(
    {
      templateId: "blogArticle",
      placement: "product page",
      placementUrl: "https://synclip.ai/lipsync-video-generator",
      title: "Lipsync Video Generator",
      meta: "Create lipsync videos",
      sections: [{ heading: "Intro", body: "Generic article body." }],
      blocks: [],
      schemaSuggestion: { type: "FAQPage", reason: "test" },
    },
    { keyword: "lipsync video generator", placement: "product page", format: "landing" },
    {
      pages: [
        {
          url: "https://synclip.ai/ai-talking-head-video-generator",
          title: "AI Talking Head Video Generator",
          h1: "AI Talking Head Video Generator",
        },
      ],
    },
    { url: "https://synclip.ai/" },
  );

  assert.equal(audit.hasFailures, true);
  assert.ok(audit.checks.some((check) => check.label === "Template match" && check.status === "fail"));
  assert.ok(audit.checks.some((check) => check.label === "URL strategy" && check.status === "fail"));
});

test("buildDraft creates product page blocks and template QA for product placements", () => {
  const draft = buildDraft(
    {
      title: "Lipsync Video Generator",
      keyword: "lipsync video generator",
      placement: "product page",
      format: "landing",
    },
    { url: "https://synclip.ai/", domain: "synclip.ai", category: "AI video platform", audience: "creators", goal: "start a trial" },
    {
      ok: true,
      startUrl: "https://synclip.ai/",
      pages: [
        {
          url: "https://synclip.ai/ai-talking-head-video-generator",
          title: "AI Talking Head Video Generator",
          h1: "AI Talking Head Video Generator",
        },
      ],
    },
  );

  assert.equal(draft.templateId, "productPage");
  assert.ok(draft.blocks.some((block) => block.type === "hero"));
  assert.ok(draft.blocks.some((block) => block.type === "steps"));
  assert.ok(draft.qaChecks.some((check) => check.label === "Template structure" && check.status === "pass"));
});

test("buildDraftPrompt includes selected template instructions", () => {
  const prompt = buildDraftPrompt(
    { url: "https://synclip.ai/", domain: "synclip.ai" },
    { title: "Lipsync page", keyword: "lipsync video generator", placement: "product page", format: "landing" },
    [],
    { ok: true, pages: [] },
  );

  assert.match(prompt.instructions, /productPage/);
  assert.match(prompt.instructions, /hero/);
  assert.match(prompt.message, /"selectedTemplate"/);
});

test("normalizeWorkflow attaches template audit to drafts", () => {
  const workflow = normalizeWorkflow(
    {
      inputs: { url: "https://synclip.ai/", domain: "synclip.ai" },
      strategy: {},
      keywords: [{ keyword: "lipsync video generator", intent: "Buyer", commercialValue: 5, difficulty: 2, productFit: 5 }],
      calendar: [{ day: 1, title: "Lipsync page", keyword: "lipsync video generator", placement: "product page", format: "landing" }],
      drafts: [
        buildDraft(
          { title: "Lipsync page", keyword: "lipsync video generator", placement: "product page", format: "landing" },
          { url: "https://synclip.ai/", domain: "synclip.ai", category: "AI video", audience: "creators", goal: "trial" },
          { ok: true, pages: [] },
        ),
      ],
      checklist: [],
      siteContext: { ok: true, pages: [] },
    },
    { url: "https://synclip.ai/", domain: "synclip.ai" },
  );

  assert.equal(workflow.drafts[0].templateId, "productPage");
  assert.ok(workflow.drafts[0].qaChecks.some((check) => check.label === "Template match"));
});

test("normalizeWorkflow turns structured meta and blank QA checks into publishable draft fields", () => {
  const workflow = normalizeWorkflow(
    {
      inputs: { url: "https://synclip.ai/", domain: "synclip.ai" },
      strategy: {},
      keywords: [{ keyword: "ai talking head video generator", intent: "Buyer", commercialValue: 5, difficulty: 2, productFit: 5 }],
      calendar: [
        {
          day: 1,
          title: "Create AI Talking Head Videos",
          keyword: "ai talking head video generator",
          placement: "product page",
          format: "landing",
        },
      ],
      drafts: [
        {
          title: "Create AI Talking Head Videos",
          meta: { description: "Create AI talking head videos from one portrait and a script with Synclip." },
          placement: "product page",
          placementUrl: "https://synclip.ai/ai-talking-head-video-generator",
          blocks: [
            { type: "hero", heading: "AI talking head videos", body: "Create presenter videos.", primaryCta: "Start free" },
            { type: "steps", items: [{ step: 1, title: "Upload", body: "Add a portrait." }] },
            { type: "features", items: [{ title: "Portrait input", body: "Start from one image." }] },
            { type: "faq", items: [{ question: "Can I use one image?", answer: "Yes." }] },
            { type: "cta", heading: "Create a video", body: "Start with Synclip.", buttonText: "Start free" },
          ],
          qaChecks: [
            { status: "pass" },
            { label: "Grounding", status: "pass", detail: "Uses crawled Synclip pages." },
          ],
        },
      ],
      checklist: [],
      siteContext: {
        ok: true,
        startUrl: "https://synclip.ai/",
        pages: [{ url: "https://synclip.ai/ai-talking-head-video-generator", title: "AI Talking Head Video Generator" }],
      },
    },
    { url: "https://synclip.ai/", domain: "synclip.ai" },
  );

  assert.equal(workflow.drafts[0].meta, "Create AI talking head videos from one portrait and a script with Synclip.");
  assert.equal(workflow.drafts[0].qaChecks.some((check) => check.label === "Check" && !check.detail), false);
  assert.ok(workflow.drafts[0].qaChecks.some((check) => check.label === "Grounding"));
  const markdown = draftToMarkdown(workflow.drafts[0]);
  assert.doesNotMatch(markdown, /\[object Object\]/);
  assert.doesNotMatch(markdown, /pass: Check -\s*$/m);
});

test("normalizeWorkflow respects requested content plan length", () => {
  const calendar = Array.from({ length: 12 }, (_, index) => ({
    day: index + 1,
    title: `Topic ${index + 1}`,
    keyword: `topic ${index + 1}`,
    placement: "blog",
    format: "guide",
  }));
  const drafts = Array.from({ length: 12 }, (_, index) => ({
    title: `Topic ${index + 1}`,
    meta: `Meta ${index + 1}`,
    sections: [{ heading: `Section ${index + 1}`, body: `Body ${index + 1}` }],
    qaChecks: [],
  }));
  const workflow = normalizeWorkflow(
    {
      inputs: { url: "https://synclip.ai/", domain: "synclip.ai", planLength: 5 },
      strategy: {},
      keywords: [],
      calendar,
      drafts,
      checklist: [],
      siteContext: { ok: true, pages: [] },
    },
    { url: "https://synclip.ai/", domain: "synclip.ai" },
  );

  assert.equal(workflow.inputs.planLength, 5);
  assert.equal(workflow.calendar.length, 5);
  assert.equal(workflow.drafts.length, 5);
  assert.equal(workflow.calendarAudit.total, 5);
});
