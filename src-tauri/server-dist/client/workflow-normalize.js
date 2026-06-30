import { auditCalendar } from "../lib/content-audit.js";
import { checklistItems, normalizeChecklistItem } from "./checklist-taxonomy.js";
import { buildRefreshCandidates } from "../lib/refresh-candidates.js";
import { auditDraftFull } from "../lib/draft-quality-audit.js";
import { faqFromBlocks, ctaFromBlocks, resolveDraftTemplate } from "../lib/draft-templates.js";
import { normalizePlanLength } from "../lib/plan-length.js";
import { inferPlacementUrl, voiceRules } from "./fallback-workflow.js";

export const normalizeReferenceImages = (items) =>
  Array.isArray(items)
    ? items
        .slice(0, 8)
        .map((item) =>
          typeof item === "string"
            ? { url: item, reason: "Reference image" }
            : {
                url: item?.url || item?.src || item?.pageUrl || "",
                reason: item?.reason || item?.alt || item?.pageTitle || "Reference image",
              },
        )
        .filter((item) => item.url)
    : [];

const normalizeTextField = (value, fallback = "") => {
  if (typeof value === "string") return value.trim();
  if (!value || typeof value !== "object") return fallback;
  const preferredKeys = ["description", "metaDescription", "summary", "text", "body", "copy", "title"];
  const found = preferredKeys
    .map((key) => value[key])
    .find((item) => typeof item === "string" && item.trim());
  if (found) return found.trim();
  const parts = Object.values(value).filter((item) => typeof item === "string" && item.trim());
  return parts.length ? parts.join(" ").trim() : fallback;
};

const normalizeQaCheck = (item) => {
  if (typeof item === "string") {
    return item.trim() ? { label: "Check", status: "warn", detail: item.trim() } : null;
  }
  const label = normalizeTextField(item?.label, "");
  const detail = normalizeTextField(item?.detail || item?.reason, "");
  if (!label && !detail) return null;
  return {
    label: label || "Check",
    status: ["pass", "warn", "fail"].includes(item?.status) ? item.status : "warn",
    detail,
  };
};

const normalizeSiteContext = (siteContext, inputs) => {
  const context = siteContext && typeof siteContext === "object" ? siteContext : {};
  const discovery = context.discovery && typeof context.discovery === "object" ? context.discovery : {};
  const summary = context.summary && typeof context.summary === "object" ? context.summary : {};
  return {
    ok: Boolean(context.ok),
    error: context.error || "",
    startUrl: context.startUrl || inputs.url,
    domain: context.domain || inputs.domain,
    discovery: {
      strategy: discovery.strategy || "unknown",
      robotsUrl: discovery.robotsUrl || "",
      robotsOk: Boolean(discovery.robotsOk),
      sitemaps: Array.isArray(discovery.sitemaps) ? discovery.sitemaps : [],
      pagesDiscovered: Number(discovery.pagesDiscovered || 0),
      pagesFetched: Number(discovery.pagesFetched || 0),
      pagesFailed: Number(discovery.pagesFailed || 0),
      limits: discovery.limits || {},
    },
    summary: {
      pageCount: Number(summary.pageCount || 0),
      pageTypes: summary.pageTypes && typeof summary.pageTypes === "object" ? summary.pageTypes : {},
      corePages: Array.isArray(summary.corePages) ? summary.corePages : [],
      referenceImages: normalizeReferenceImages(summary.referenceImages),
    },
    pages: Array.isArray(context.pages) ? context.pages.slice(0, 80) : [],
    failures: Array.isArray(context.failures) ? context.failures.slice(0, 40) : [],
    events: Array.isArray(context.events) ? context.events.slice(0, 80) : [],
  };
};

export const normalizeDraft = (draft, context = {}) => {
  const calendarItem = context.calendarItem || {};
  const siteContext = context.siteContext || null;
  const inputs = context.inputs || {};
  const template = resolveDraftTemplate(calendarItem, draft);
  const visualPlan = draft.visualPlan || {
    recommended: "product screenshot",
    reason: "A real interface image is usually more credible than a decorative illustration.",
    promptOrSpec: "Use a product screenshot or website hero screenshot that shows the workflow being discussed.",
  };
  const normalized = {
    ...draft,
    templateId: draft.templateId || template.id,
    templateLabel: draft.templateLabel || template.label,
    meta:
      normalizeTextField(draft.meta, "") ||
      normalizeTextField(
        draft.metaDescription,
        `A practical ${calendarItem.format || "guide"} about ${calendarItem.keyword || inputs.category || inputs.domain}.`,
      ),
    blocks: Array.isArray(draft.blocks) ? draft.blocks : [],
    cta:
      typeof draft.cta === "string"
        ? draft.cta
        : [draft.cta?.heading, draft.cta?.body, draft.cta?.buttonText].filter(Boolean).join(" "),
    faq: Array.isArray(draft.faq)
      ? draft.faq.map((item) =>
          typeof item === "string" ? item : [item?.question, item?.answer].filter(Boolean).join(" — "),
        )
      : faqFromBlocks(draft.blocks),
    placement: draft.placement || template.label,
    placementUrl: draft.placementUrl || draft.publishUrl || "",
    placementStrategy: draft.placementStrategy || "",
    evidenceRefs: Array.isArray(draft.evidenceRefs)
      ? draft.evidenceRefs.map((item) =>
          typeof item === "string"
            ? { source: "website", quote: item, usedFor: "Draft grounding" }
            : {
                url: item?.url || item?.pageUrl || "",
                pageTitle: item?.pageTitle || item?.title || "",
                source: item?.source || "website",
                quote: item?.quote || item?.text || "",
                usedFor: item?.usedFor || item?.usage || "Draft grounding",
              },
        )
      : [],
    qaChecks: Array.isArray(draft.qaChecks) ? draft.qaChecks.map((item) => normalizeQaCheck(item)).filter(Boolean) : [],
    visualPlan: {
      ...visualPlan,
      recommended: visualPlan.recommended || visualPlan.assetType || "product screenshot",
      prompt: visualPlan.prompt || visualPlan.promptOrSpec || "",
      promptOrSpec: visualPlan.promptOrSpec || visualPlan.prompt || "",
      negativePrompt: visualPlan.negativePrompt || "",
      referenceImages: normalizeReferenceImages(visualPlan.referenceImages),
      altText: visualPlan.altText || "",
    },
    schemaSuggestion:
      draft.schemaSuggestion && typeof draft.schemaSuggestion === "object"
        ? {
            type: draft.schemaSuggestion.type || "Article",
            reason: draft.schemaSuggestion.reason || "Use structured data to clarify page intent.",
          }
        : {
            type: "Article",
            reason: "Default article schema for editorial SEO content.",
          },
  };

  if (!normalized.cta) {
    normalized.cta = ctaFromBlocks(normalized.blocks);
  }

  const draftIntent = draft.draftRuntime?.intent || null;
  const audit = auditDraftFull(normalized, calendarItem, siteContext, inputs, draftIntent);
  const existingLabels = new Set((normalized.qaChecks || []).map((check) => check.label));
  const mergedChecks = [
    ...(normalized.qaChecks || []),
    ...audit.checks.filter((check) => !existingLabels.has(check.label)),
  ];
  normalized.qaChecks = mergedChecks;
  normalized.templateAudit = {
    hasFailures: audit.hasFailures,
    suggestedPlacement: audit.suggestedPlacement,
  };
  if (draft.draftRuntime) {
    normalized.draftRuntime = draft.draftRuntime;
  }
  return normalized;
};

export const normalizeWorkflow = (workflow, fallbackInputs) => {
  const inputs = {
    ...fallbackInputs,
    ...(workflow.inputs && typeof workflow.inputs === "object" ? workflow.inputs : {}),
    domain: workflow.inputs?.domain || fallbackInputs.domain,
  };
  const planLength = normalizePlanLength(inputs.planLength);
  const rawCalendar = Array.isArray(workflow.calendar) ? workflow.calendar.slice(0, planLength) : [];
  const strategy = workflow.strategy && typeof workflow.strategy === "object" ? workflow.strategy : {};
  const contentPillars = Array.isArray(strategy.contentPillars) ? strategy.contentPillars.join(", ") : "";
  const workflowSteps = Array.isArray(strategy.workflow) ? strategy.workflow.join(" ") : "";

  const siteContext = normalizeSiteContext(workflow.siteContext, inputs);
  const refreshCandidates =
    Array.isArray(strategy.refreshCandidates) && strategy.refreshCandidates.length > 0
      ? strategy.refreshCandidates.slice(0, 12)
      : buildRefreshCandidates(siteContext);
  const calendarAudit = auditCalendar(
    rawCalendar,
    inputs,
    siteContext,
  );

  return {
    ...workflow,
    inputs: {
      ...inputs,
      planLength,
    },
    strategy: {
      positioning: strategy.positioning || strategy.angle || `${inputs.domain} planning workspace for ${inputs.audience}.`,
      customer: strategy.customer || strategy.audience || inputs.audience,
      promise: strategy.promise || strategy.primaryCTA || `Help users ${inputs.goal}.`,
      voice: strategy.voice || voiceRules[inputs.voice]?.line || inputs.voice,
      contentGap: strategy.contentGap || contentPillars || "Search themes, planning notes, draft outlines, and refresh targets.",
      publishingRule: strategy.publishingRule || workflowSteps || "Plan, draft, edit, publish, measure, and refresh.",
      refreshCandidates,
    },
    keywords: Array.isArray(workflow.keywords)
      ? workflow.keywords.slice(0, 12).map((keyword) => ({
          ...keyword,
          questionVariants: Array.isArray(keyword.questionVariants)
            ? keyword.questionVariants.slice(0, 5).map((item) => String(item))
            : [],
        }))
      : [],
    calendar: calendarAudit.items,
    calendarAudit: workflow.calendarAudit || calendarAudit.summary,
    drafts: Array.isArray(workflow.drafts)
      ? workflow.drafts.slice(0, planLength).map((draft, index) => {
          const calendarItem = rawCalendar[index] || rawCalendar[0] || {};
          const normalized = normalizeDraft(draft, {
            calendarItem: { ...calendarItem, placement: draft.placement || calendarItem.placement },
            siteContext,
            inputs,
          });
          normalized.placementUrl =
            normalized.placementUrl ||
            inferPlacementUrl(normalized.placement, siteContext, inputs);
          return normalized;
        })
      : [],
    checklist: Array.isArray(workflow.checklist)
      ? workflow.checklist.slice(0, 24).map((item) => normalizeChecklistItem(item))
      : checklistItems.map((item) => normalizeChecklistItem(item)),
    siteContext,
  };
};
