import assert from "node:assert/strict";
import test from "node:test";

import { detectFatigueWords, detectForbiddenPatterns } from "../lib/anti-ai-rules.js";
import {
  buildDraftPlanPrompt,
  buildDraftRevisePrompt,
  buildDraftWritePrompt,
} from "../lib/ai-prompts.js";
import { composeDraftContext, scorePageRelevance, selectRelevantPages } from "../lib/draft-compose.js";
import { buildFallbackIntent, normalizeDraftIntent } from "../lib/draft-intent.js";
import { auditDraftFull, auditDraftQuality } from "../lib/draft-quality-audit.js";
import { runDraftPipeline } from "../lib/draft-pipeline.js";

const siteContext = {
  ok: true,
  startUrl: "https://synclip.ai/",
  domain: "synclip.ai",
  pages: [
    {
      url: "https://synclip.ai/ai-talking-head-video-generator",
      title: "AI Talking Head Video Generator",
      h1: "AI Talking Head Video Generator",
      metaDescription: "Create talking head videos from one portrait.",
      pageText: "Upload a portrait, add a script, and export lipsync video.",
      pageType: "product",
    },
    {
      url: "https://synclip.ai/pricing",
      title: "Pricing",
      h1: "Pricing",
      metaDescription: "Plans for creators.",
      pageText: "Free and pro plans.",
      pageType: "pricing",
    },
    {
      url: "https://synclip.ai/blog/unrelated-topic",
      title: "Unrelated",
      h1: "Unrelated",
      pageText: "Something else entirely.",
      pageType: "blog",
    },
  ],
};

const calendarItem = {
  title: "Create AI Talking Head Videos",
  keyword: "ai talking head video generator",
  placement: "blog",
  format: "guide",
};

const input = {
  url: "https://synclip.ai/",
  domain: "synclip.ai",
  category: "AI video platform",
  audience: "creators",
  goal: "start a trial",
  voice: "editorial",
};

test("selectRelevantPages ranks keyword-overlapping product pages first", () => {
  const pages = selectRelevantPages(siteContext, {
    keyword: calendarItem.keyword,
    mustCover: ["portrait upload", "lipsync export"],
    maxPages: 2,
  });
  assert.equal(pages[0].url, "https://synclip.ai/ai-talking-head-video-generator");
  assert.equal(pages.length, 2);
});

test("scorePageRelevance returns higher score for matching pages", () => {
  const tokens = ["talking", "head", "video", "generator"];
  const productScore = scorePageRelevance(siteContext.pages[0], tokens);
  const unrelatedScore = scorePageRelevance(siteContext.pages[2], tokens);
  assert.ok(productScore > unrelatedScore);
});

test("composeDraftContext includes intent, ruleStack, and selected pages", () => {
  const intent = buildFallbackIntent(calendarItem, input, siteContext);
  const composed = composeDraftContext({
    input,
    calendarItem,
    siteContext,
    draftIntent: intent,
    existingTitles: [],
  });

  assert.ok(composed.pages.length > 0);
  assert.ok(composed.ruleStack.antiAiRules);
  assert.ok(composed.ruleStack.voiceRules.length > 0);
  assert.equal(composed.intent.angle, intent.angle);
  assert.ok(composed.urlStrategy.targetUrl);
});

test("buildDraftPlanPrompt and buildDraftWritePrompt include pipeline fields", () => {
  const intent = buildFallbackIntent(calendarItem, input, siteContext);
  const composed = composeDraftContext({ input, calendarItem, siteContext, draftIntent: intent });
  const planPrompt = buildDraftPlanPrompt(input, calendarItem, siteContext);
  const writePrompt = buildDraftWritePrompt(composed);

  assert.match(planPrompt.instructions, /sectionOutline/);
  assert.match(writePrompt.instructions, /sectionOutline/);
  assert.match(writePrompt.message, /"intent"/);
  assert.match(writePrompt.message, /"ruleStack"/);
});

test("auditDraftQuality fails on AI fatigue words and forbidden patterns", () => {
  const intent = buildFallbackIntent(calendarItem, input, siteContext);
  const draft = {
    title: "Test",
    meta: "Meta",
    sections: [
      {
        heading: "Intro",
        body: "In today's fast-paced digital landscape, leverage seamless AI to unlock robust results.",
      },
      { heading: "Next", body: "Whether you're a beginner or a pro, this game-changer empowers you." },
    ],
    blocks: [],
    evidenceRefs: [],
  };

  const audit = auditDraftQuality(draft, intent, siteContext, input);
  assert.ok(audit.hasCriticalFailures);
  assert.ok(audit.checks.some((check) => check.label === "AI flavor" && check.status === "fail"));
  assert.ok(audit.checks.some((check) => check.label === "AI patterns" && check.status === "fail"));
});

test("auditDraftFull merges structural and quality checks", () => {
  const intent = normalizeDraftIntent(
    {
      mustCover: ["portrait upload workflow", "lipsync export"],
      sectionOutline: [
        { id: "s1", purpose: "Explain portrait upload", transitionFrom: "Opens from headline" },
      ],
    },
    calendarItem,
    input,
  );

  const draft = {
    templateId: "blogArticle",
    title: calendarItem.title,
    meta: "Guide",
    placementUrl: "https://synclip.ai/blog/ai-talking-head-video-generator",
    sections: [
      {
        heading: "Portrait upload",
        body: "Upload a portrait on Synclip and export lipsync video from the talking head generator page.",
      },
    ],
    blocks: [],
    schemaSuggestion: { type: "Article", reason: "test" },
    evidenceRefs: [
      {
        url: "https://synclip.ai/ai-talking-head-video-generator",
        pageTitle: "AI Talking Head Video Generator",
        source: "website crawl",
        quote: "Upload a portrait",
        usedFor: "Workflow",
      },
      {
        url: "https://synclip.ai/pricing",
        pageTitle: "Pricing",
        source: "website crawl",
        quote: "Plans",
        usedFor: "Pricing",
      },
    ],
  };

  const audit = auditDraftFull(draft, calendarItem, siteContext, input, intent);
  assert.ok(audit.checks.some((check) => check.label === "Template match"));
  assert.ok(audit.checks.some((check) => check.label === "Evidence grounding" && check.status === "pass"));
});

test("buildDraftRevisePrompt includes revise hints and mode", () => {
  const intent = buildFallbackIntent(calendarItem, input, siteContext);
  const composed = composeDraftContext({ input, calendarItem, siteContext, draftIntent: intent });
  const audit = {
    reviseMode: "anti-detect",
    reviseHints: [{ mode: "anti-detect", target: "full", detail: "Remove leverage and unlock." }],
    criticalFailures: [{ label: "AI flavor", status: "fail", detail: "Fatigue words detected." }],
  };
  const prompt = buildDraftRevisePrompt({ title: "Test", sections: [] }, audit, composed);
  assert.match(prompt.instructions, /anti-detect/);
  assert.match(prompt.message, /reviseHints/);
});

test("runDraftPipeline orchestrates plan compose write audit revise", async () => {
  const calls = [];
  const goodDraft = {
    templateId: "blogArticle",
    templateLabel: "Blog article",
    title: calendarItem.title,
    meta: "Create talking head videos with Synclip portrait upload and lipsync export.",
    placement: "blog",
    placementUrl: "https://synclip.ai/blog/ai-talking-head-video-generator",
    sections: [
      {
        heading: "Portrait workflow",
        body: "Upload a portrait on Synclip, add a script on the talking head generator page, and export lipsync video.",
      },
      {
        heading: "Choose a plan",
        body: "Review pricing when you need more exports for creator campaigns.",
      },
    ],
    blocks: [],
    faq: ["How do I start? — Upload a portrait."],
    cta: "Start free on Synclip.",
    schemaSuggestion: { type: "Article", reason: "Guide" },
    visualPlan: { recommended: "product screenshot", reason: "Show UI", prompt: "", referenceImages: [], altText: "" },
    evidenceRefs: [
      {
        url: "https://synclip.ai/ai-talking-head-video-generator",
        pageTitle: "AI Talking Head Video Generator",
        source: "website crawl",
        quote: "Upload a portrait",
        usedFor: "Workflow",
      },
      {
        url: "https://synclip.ai/pricing",
        pageTitle: "Pricing",
        source: "website crawl",
        quote: "Plans",
        usedFor: "Pricing",
      },
    ],
    qaChecks: [],
  };

  const aiDraft = {
    ...goodDraft,
    sections: [
      {
        heading: "Intro",
        body: "In today's fast-paced landscape, leverage seamless AI to unlock robust talking head results.",
      },
    ],
  };

  const result = await runDraftPipeline({
    input,
    calendarItem,
    existingTitles: [],
    siteContext,
    onStage: (stage) => calls.push(stage),
    callModel: async (prompt, { stage }) => {
      calls.push(`llm:${stage}`);
      if (stage === "plan") {
        return {
          parsed: buildFallbackIntent(calendarItem, input, siteContext),
          usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
        };
      }
      if (stage === "write") {
        return {
          parsed: aiDraft,
          usage: { input_tokens: 30, output_tokens: 40, total_tokens: 70 },
        };
      }
      if (stage === "revise") {
        return {
          parsed: goodDraft,
          usage: { input_tokens: 20, output_tokens: 30, total_tokens: 50 },
        };
      }
      throw new Error(`Unexpected stage ${stage}`);
    },
  });

  assert.deepEqual(calls.slice(0, 5), ["plan", "llm:plan", "compose", "write", "llm:write"]);
  assert.ok(calls.includes("audit"));
  assert.ok(calls.includes("revise"));
  assert.equal(result.draftRuntime.reviseApplied, true);
  assert.ok(result.draft.draftRuntime.intent.angle);
  assert.ok(!detectFatigueWords(collectText(result.draft)).some((hit) => hit.severity === "fail"));
});

const collectText = (draft) =>
  [draft.meta, ...(draft.sections || []).map((section) => section.body)].join(" ");

test("detectFatigueWords and detectForbiddenPatterns catch common AI copy", () => {
  const text = "Leverage this seamless toolkit to unlock robust traction.";
  assert.ok(detectFatigueWords(text).length > 0);
  assert.ok(detectForbiddenPatterns("In today's fast-paced digital landscape, teams win.").length > 0);
});

test("buildDraft fallback includes draftRuntime intent", async () => {
  const { buildDraft } = await import("../client/fallback-workflow.js");
  const draft = buildDraft(calendarItem, input, siteContext);
  assert.ok(draft.draftRuntime?.intent?.sectionOutline?.length > 0);
  assert.ok(draft.draftRuntime.composedPageCount > 0);
});
