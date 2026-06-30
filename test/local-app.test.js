import assert from "node:assert/strict";
import test from "node:test";

import { createFallbackWorkflow, inferPlacementUrl } from "../client/fallback-workflow.js";
import { workflowToMarkdown } from "../client/markdown-export.js";
import {
  createExportBundle,
  createProjectRecord,
  importProjectPackageFromText,
  readProjectRecords,
  removeProjectRecord,
  upsertProjectRecord,
  writeProjectRecords,
} from "../client/local-projects.js";

const inputs = {
  rawUrl: "https://example.com",
  url: "https://example.com",
  domain: "example.com",
  category: "AI SEO automation",
  audience: "founders",
  goal: "start a trial",
  voice: "sharp",
};

const createMemoryStorage = () => {
  const data = new Map();
  return {
    getItem: (key) => data.get(key) || null,
    setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key),
  };
};

test("createFallbackWorkflow returns site coverage and leaves starter draft optional", () => {
  const workflowWithoutCrawl = createFallbackWorkflow(inputs);
  assert.equal(workflowWithoutCrawl.siteContext.startUrl, "https://example.com");
  assert.equal(workflowWithoutCrawl.siteContext.discovery.strategy, "local-fallback");
  assert.equal(workflowWithoutCrawl.drafts.length, 0);

  const workflow = createFallbackWorkflow(inputs, {
    ok: true,
    startUrl: "https://example.com/",
    pages: [{ url: "https://example.com/", title: "Example", pageType: "home", metaDescription: "Example product" }],
    summary: { pageCount: 1, pageTypes: { home: 1 } },
    discovery: { robotsOk: true, sitemaps: ["https://example.com/sitemap.xml"] },
  });

  assert.equal(workflow.drafts.length, 0);

  const workflowWithDraft = createFallbackWorkflow({ ...inputs, includeDraft: true }, {
    ok: true,
    startUrl: "https://example.com/",
    pages: [{ url: "https://example.com/", title: "Example", pageType: "home", metaDescription: "Example product" }],
    summary: { pageCount: 1, pageTypes: { home: 1 } },
    discovery: { robotsOk: true, sitemaps: ["https://example.com/sitemap.xml"] },
  });

  assert.equal(workflowWithDraft.drafts[0].evidenceRefs[0].url, "https://example.com/");
});

test("workflowToMarkdown handles analysis-only workspaces", () => {
  const workflow = createFallbackWorkflow(inputs);
  const markdown = workflowToMarkdown(workflow);

  assert.match(markdown, /No starter draft generated yet/);
});

test("createFallbackWorkflow clamps configurable content plan length", () => {
  const shortPlan = createFallbackWorkflow({ ...inputs, planLength: 5 });
  const longPlan = createFallbackWorkflow({ ...inputs, planLength: 99 });
  const defaultPlan = createFallbackWorkflow(inputs);

  assert.equal(shortPlan.inputs.planLength, 5);
  assert.equal(shortPlan.calendar.length, 5);
  assert.equal(longPlan.inputs.planLength, 30);
  assert.equal(longPlan.calendar.length, 30);
  assert.equal(defaultPlan.inputs.planLength, 14);
  assert.equal(defaultPlan.calendar.length, 14);
});

test("createFallbackWorkflow does not claim crawled data when crawl failed", () => {
  const workflow = createFallbackWorkflow(inputs, {
    ok: false,
    error: "No crawlable HTML pages were fetched.",
    startUrl: "https://example.com/",
    pages: [],
    summary: { pageCount: 0, pageTypes: {} },
    discovery: { strategy: "crawl", pagesFetched: 0 },
    events: [],
  });
  const fallbackEvent = workflow.siteContext.events.at(-1);

  assert.match(fallbackEvent.detail, /site crawl did not return pages/i);
  assert.doesNotMatch(fallbackEvent.detail, /with crawled site data/i);
});

test("inferPlacementUrl prefers blog and docs pages from site context", () => {
  const siteContext = {
    ok: true,
    startUrl: "https://example.com/",
    pages: [
      { url: "https://example.com/", pageType: "home" },
      { url: "https://example.com/blog", pageType: "blog" },
      { url: "https://example.com/docs/start", pageType: "docs" },
    ],
  };

  assert.equal(
    inferPlacementUrl("blog", siteContext, { url: "https://example.com/" }),
    "https://example.com/blog",
  );
  assert.equal(
    inferPlacementUrl("docs", siteContext, { url: "https://example.com/" }),
    "https://example.com/docs/start",
  );
});

test("createProjectRecord stores local metadata without mutating workflow", () => {
  const workflow = createFallbackWorkflow(inputs);
  const record = createProjectRecord(workflow, { provider: "codex-oauth", model: "gpt-5.5" }, "2026-06-30T10:00:00.000Z");

  assert.equal(record.id, "example-com-1782813600000");
  assert.equal(record.title, "example.com planning workspace");
  assert.equal(record.provider.model, "gpt-5.5");
  assert.equal(workflow.localProject, undefined);
  assert.equal(record.workflow.localProject.id, record.id);
});

test("upsertProjectRecord replaces existing records and keeps newest first", () => {
  const first = createProjectRecord(createFallbackWorkflow(inputs), null, "2026-06-30T10:00:00.000Z");
  const second = createProjectRecord(
    createFallbackWorkflow({ ...inputs, domain: "second.example", url: "https://second.example" }),
    null,
    "2026-06-30T11:00:00.000Z",
  );
  const updatedFirst = { ...first, title: "Updated title" };

  const records = upsertProjectRecord(upsertProjectRecord([first], second), updatedFirst);

  assert.deepEqual(
    records.map((record) => record.title),
    ["second.example planning workspace", "Updated title"],
  );
});

test("project records can be written, read, and removed from local storage", () => {
  const storage = createMemoryStorage();
  const record = createProjectRecord(createFallbackWorkflow(inputs), null, "2026-06-30T10:00:00.000Z");

  assert.equal(writeProjectRecords(storage, [record]), true);
  assert.equal(readProjectRecords(storage)[0].id, record.id);
  assert.equal(writeProjectRecords(storage, removeProjectRecord(readProjectRecords(storage), record.id)), true);

  assert.deepEqual(readProjectRecords(storage), []);
});

test("writeProjectRecords reports storage quota failures without throwing", () => {
  const storage = {
    getItem: () => null,
    setItem: () => {
      throw new Error("quota");
    },
  };
  const record = createProjectRecord(createFallbackWorkflow(inputs), null, "2026-06-30T10:00:00.000Z");

  assert.equal(writeProjectRecords(storage, [record]), false);
});

test("createExportBundle includes workflow, markdown, and site pages", () => {
  const workflow = createFallbackWorkflow(inputs);
  const bundle = createExportBundle(workflow, "# Markdown", { provider: "codex-oauth" }, "2026-06-30T12:00:00.000Z");

  assert.equal(bundle.schemaVersion, 1);
  assert.equal(bundle.markdown, "# Markdown");
  assert.equal(bundle.provider.provider, "codex-oauth");
  assert.deepEqual(bundle.sitePages, workflow.siteContext.pages);
});

test("importProjectPackageFromText restores an exported package as a local project record", () => {
  const workflow = createFallbackWorkflow(inputs);
  const bundle = createExportBundle(workflow, "# Markdown", { provider: "codex-oauth" }, "2026-06-30T12:00:00.000Z");
  const record = importProjectPackageFromText(JSON.stringify(bundle), "2026-06-30T13:00:00.000Z");

  assert.equal(record.domain, "example.com");
  assert.equal(record.provider.provider, "codex-oauth");
  assert.equal(record.workflow.inputs.url, "https://example.com");
  assert.equal(record.workflow.localProject.id, record.id);
});

test("importProjectPackageFromText rejects invalid local project packages", () => {
  const workflow = createFallbackWorkflow(inputs);

  assert.throws(() => importProjectPackageFromText("{broken json"), /valid JSON/);
  assert.throws(() => importProjectPackageFromText(JSON.stringify({ schemaVersion: 1 })), /workflow/);
  assert.throws(
    () => importProjectPackageFromText(JSON.stringify({ workflow: { ...workflow, checklist: undefined } })),
    /checklist/,
  );
  assert.throws(
    () => importProjectPackageFromText(JSON.stringify({ workflow: { ...workflow, drafts: [{ title: "Incomplete" }] } })),
    /drafts/,
  );
  assert.throws(() => importProjectPackageFromText("x".repeat(5_000_001)), /too large/);
});
