import {
  buildDraftPlanPrompt,
  buildDraftRevisePrompt,
  buildDraftWritePrompt,
} from "./ai-prompts.js";
import { composeDraftContext } from "./draft-compose.js";
import { buildFallbackIntent, normalizeDraftIntent } from "./draft-intent.js";
import { auditDraftFull } from "./draft-quality-audit.js";

export const DRAFT_PIPELINE_CONFIG = {
  maxReviseRounds: 1,
  requirePlan: true,
  draftTimeoutMs: 180_000,
};

const mergeDraftQaFromAudit = (draft, audit, extraChecks = []) => {
  const existingLabels = new Set((draft.qaChecks || []).map((check) => check.label));
  draft.qaChecks = [
    ...(Array.isArray(draft.qaChecks) ? draft.qaChecks : []),
    ...extraChecks,
    ...audit.checks.filter((check) => !existingLabels.has(check.label)),
  ];
  draft.templateAudit = {
    hasFailures: audit.hasFailures,
    suggestedPlacement: audit.suggestedPlacement,
  };
  return draft;
};

export const runDraftPipeline = async ({
  input,
  calendarItem,
  existingTitles = [],
  siteContext = null,
  callModel,
  onStage,
  config = DRAFT_PIPELINE_CONFIG,
}) => {
  if (typeof callModel !== "function") {
    throw new Error("callModel is required for draft pipeline.");
  }

  const pipelineStages = [];
  const notify = (stage) => {
    pipelineStages.push(stage);
    if (typeof onStage === "function") onStage(stage);
  };

  let draftIntent = null;
  let usageTotal = { input_tokens: 0, output_tokens: 0, total_tokens: 0, estimated: false };

  const accumulateUsage = (usage) => {
    if (!usage) return;
    if (usage.estimated) usageTotal.estimated = true;
    for (const key of ["input_tokens", "output_tokens", "total_tokens"]) {
      if (typeof usage[key] === "number") {
        usageTotal[key] = (usageTotal[key] || 0) + usage[key];
      }
    }
  };

  notify("plan");
  if (config.requirePlan) {
    try {
      const planPrompt = buildDraftPlanPrompt(input, calendarItem, siteContext);
      const planResult = await callModel(planPrompt, { stage: "plan", timeoutMs: config.draftTimeoutMs });
      accumulateUsage(planResult.usage);
      draftIntent = normalizeDraftIntent(planResult.parsed, calendarItem, input);
    } catch {
      draftIntent = buildFallbackIntent(calendarItem, input, siteContext);
    }
  } else {
    draftIntent = buildFallbackIntent(calendarItem, input, siteContext);
  }

  notify("compose");
  const composedContext = composeDraftContext({
    input,
    calendarItem,
    siteContext,
    draftIntent,
    existingTitles,
  });

  notify("write");
  const writePrompt = buildDraftWritePrompt(composedContext);
  const writeResult = await callModel(writePrompt, { stage: "write", timeoutMs: config.draftTimeoutMs });
  accumulateUsage(writeResult.usage);
  let draft = writeResult.parsed;

  if (!draft.placementUrl && composedContext.urlStrategy?.targetUrl) {
    draft.placementUrl = composedContext.urlStrategy.targetUrl;
  }
  if (!draft.placementStrategy && composedContext.urlStrategy?.strategy) {
    draft.placementStrategy = composedContext.urlStrategy.strategy;
  }

  notify("audit");
  let audit = auditDraftFull(draft, calendarItem, siteContext, input, draftIntent);
  draft = mergeDraftQaFromAudit(draft, audit);

  let reviseApplied = false;
  if (audit.hasFailures && config.maxReviseRounds > 0) {
    notify("revise");
    const revisePrompt = buildDraftRevisePrompt(draft, audit, composedContext);
    const reviseResult = await callModel(revisePrompt, { stage: "revise", timeoutMs: config.draftTimeoutMs });
    accumulateUsage(reviseResult.usage);
    draft = reviseResult.parsed;
    reviseApplied = true;

    notify("audit");
    audit = auditDraftFull(draft, calendarItem, siteContext, input, draftIntent);
    draft = mergeDraftQaFromAudit(draft, audit, [
      {
        label: "Pipeline revise",
        status: audit.hasFailures ? "warn" : "pass",
        detail: audit.hasFailures
          ? "Auto-revise ran but some quality checks still fail. Review or regenerate."
          : "Auto-revise resolved critical quality issues.",
      },
    ]);
  }

  const draftRuntime = {
    intent: draftIntent,
    composedPageCount: composedContext.pages?.length || 0,
    pipelineStages,
    reviseApplied,
    urlStrategy: composedContext.urlStrategy,
  };

  draft.draftRuntime = draftRuntime;

  return {
    draft,
    draftRuntime,
    usage: usageTotal,
    audit,
  };
};
