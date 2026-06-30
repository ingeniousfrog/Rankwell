import assert from "node:assert/strict";
import test from "node:test";

import {
  crawlProgressValue,
  createProgressReporter,
  getVisibleProgressStages,
} from "../lib/generate-progress.js";

test("getVisibleProgressStages hides draft stage when draft generation is disabled", () => {
  const withoutDraft = getVisibleProgressStages(false);
  const withDraft = getVisibleProgressStages(true);

  assert.equal(withoutDraft.some((stage) => stage.id === "draft"), false);
  assert.equal(withDraft.some((stage) => stage.id === "draft"), true);
});

test("crawlProgressValue interpolates between robots and crawl milestones", () => {
  const start = crawlProgressValue(0, 10);
  const middle = crawlProgressValue(5, 10);
  const end = crawlProgressValue(10, 10);

  assert.ok(start < middle);
  assert.ok(middle < end);
  assert.equal(end, 38);
});

test("createProgressReporter emits normalized progress payloads", () => {
  const events = [];
  const report = createProgressReporter((payload) => events.push(payload), { includeDraft: false });

  report("discover");
  report("draft");
  report("crawl", { progress: 25, detail: "3/12 pages" });

  assert.equal(events.length, 2);
  assert.equal(events[0].stageId, "discover");
  assert.equal(events[1].stageId, "crawl");
  assert.equal(events[1].progress, 25);
  assert.equal(events[1].detail, "3/12 pages");
});
