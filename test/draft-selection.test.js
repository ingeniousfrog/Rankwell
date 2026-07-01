import assert from "node:assert/strict";
import test from "node:test";

import { findCalendarItemForDraft } from "../client/draft-selection.js";

test("findCalendarItemForDraft prefers sourceCalendarItemId over title", () => {
  const calendar = [
    { id: "plan-1", title: "Original page refresh", keyword: "content brief template" },
    { id: "plan-2", title: "New landing page", keyword: "content planner alternatives" },
  ];
  const draft = {
    title: "Refresh brief for Content Brief Workflow",
    sourceCalendarItemId: "plan-1",
  };

  assert.deepEqual(findCalendarItemForDraft(draft, calendar), calendar[0]);
});

test("findCalendarItemForDraft returns null when regenerated brief cannot be matched", () => {
  const calendar = [{ id: "plan-1", title: "Original page refresh", keyword: "content brief template" }];
  const draft = {
    title: "Edited refresh brief title",
    sourceCalendarItemId: "missing-plan-id",
  };

  assert.equal(findCalendarItemForDraft(draft, calendar), null);
});

test("findCalendarItemForDraft keeps title fallback for older saved drafts", () => {
  const calendar = [{ id: "plan-1", title: "Original page refresh", keyword: "content brief template" }];
  const draft = {
    title: "Original page refresh",
  };

  assert.deepEqual(findCalendarItemForDraft(draft, calendar), calendar[0]);
});
