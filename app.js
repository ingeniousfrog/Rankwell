import { initAppMeta } from "./client/app-meta.js";
import {
  ANALYZE_TIMEOUT_MS,
  DRAFT_TIMEOUT_MS,
  describeSiteCrawlIssue,
  fetchWithTimeout,
  formatAnalyzeError,
  formatAnalyzeToast,
  formatDraftError,
  formatWorkspaceToast,
} from "./client/error-messages.js";
import { downloadFile } from "./client/download.js";
import { createFallbackWorkflow, parseDomain, voiceRules, inferPlacementUrl } from "./client/fallback-workflow.js";
import {
  evaluateChecklist,
  groupChecklistByCategory,
  normalizeChecklistItem,
} from "./client/checklist-taxonomy.js";
import {
  createExportBundle,
  createProjectRecord,
  formatSavedAt,
  importProjectPackageFromText,
  readProjectRecords,
  removeProjectRecord,
  upsertProjectRecord,
  writeProjectRecords,
} from "./client/local-projects.js";
import { draftToMarkdown, visualPlanToSpec, workflowToMarkdown } from "./client/markdown-export.js";
import { normalizeDraft, normalizeWorkflow } from "./client/workflow-normalize.js";
import { normalizePlanLength } from "./lib/plan-length.js";
import { getVisibleProgressStages } from "./lib/generate-progress.js";
import { auditSitePages } from "./lib/page-audit.js";
const form = document.querySelector("#workflow-form");
const websiteUrl = document.querySelector("#website-url");
const voice = document.querySelector("#voice");
const planLengthInput = document.querySelector("#plan-length");
const planLengthValue = document.querySelector("#plan-length-value");
const includeDraftInput = document.querySelector("#include-draft");
const generateButton = form.querySelector(".primary-action");
const generateLabel = document.querySelector("#generate-label");
const generateLabelInline = document.querySelector("#generate-label-inline");
const loadingView = document.querySelector("#loading-view");
const loadingStage = document.querySelector("#loading-stage");
const loadingPercent = document.querySelector("#loading-percent");
const loadingProgressBar = document.querySelector("#loading-progress-bar");
const loadingProgressTrack = document.querySelector("#loading-progress-track");
const loadingSteps = document.querySelector("#loading-steps");
const providerCard = document.querySelector("#provider-card");
const providerDot = document.querySelector("#provider-dot");
const providerStatusText = document.querySelector("#provider-status-text");
const providerDetails = document.querySelector("#provider-details");
const newAnalysisButton = document.querySelector("#new-analysis");
const exportMarkdownButton = document.querySelector("#export-markdown");
const exportJsonButton = document.querySelector("#export-json");
const projectTitle = document.querySelector("#project-title");
const strategyProfile = document.querySelector("#strategy-profile");
const machineSummary = document.querySelector("#machine-summary");
const siteCoverage = document.querySelector("#site-coverage");
const keywordList = document.querySelector("#keyword-list");
const calendarList = document.querySelector("#calendar-list");
const draftSelector = document.querySelector("#draft-selector");
const regenerateDraftButton = document.querySelector("#regenerate-draft");
const copyDraftButton = document.querySelector("#copy-draft");
const articleDraft = document.querySelector("#article-draft");
const checklistList = document.querySelector("#checklist-list");
const projectList = document.querySelector("#project-list");
const historyList = document.querySelector("#history-list");
const toast = document.querySelector("#toast");
const exportPackageButton = document.querySelector("#export-package");
const importPackageButton = document.querySelector("#import-package");
const importPackageInput = document.querySelector("#import-package-input");
const workflowBanner = document.querySelector("#workflow-banner");

let currentWorkflow = null;
let currentProvider = null;
let appPhase = "landing";
let actionHistory = [];
let projectRecords = readProjectRecords(window.localStorage);
let loadingProgressTimer = null;
let loadingProgressValue = 0;
let loadingTargetProgress = 0;
let loadingStages = getVisibleProgressStages(false);
let loadingActiveStageId = "discover";
let loadingActiveLabel = "";
let loadingStartedAt = 0;
let loadingServerSynced = false;
let loadingMaxStageIndex = 0;
let forceAnalysisOnlySubmit = false;

const LOADING_SIMULATION_SCHEDULE = [
  { ms: 0, progress: 3 },
  { ms: 2000, progress: 8 },
  { ms: 5000, progress: 15 },
  { ms: 12000, progress: 24 },
  { ms: 25000, progress: 36 },
  { ms: 45000, progress: 52 },
  { ms: 70000, progress: 66 },
  { ms: 100000, progress: 78 },
  { ms: 130000, progress: 88 },
  { ms: 170000, progress: 94 },
];

const LOADING_STAGE_TIME_MS = [0, 4000, 9000, 22000, 50000, 80000, 110000, 140000];

const resolveStageProgress = (stageId, progress) => {
  if (typeof progress === "number" && !Number.isNaN(progress)) {
    return Math.max(0, Math.min(100, progress));
  }
  const stage = loadingStages.find((item) => item.id === stageId);
  return stage?.progress ?? 0;
};

const getSimulatedLoadingProgress = (elapsedMs) => {
  let progress = LOADING_SIMULATION_SCHEDULE[0].progress;
  for (const entry of LOADING_SIMULATION_SCHEDULE) {
    if (elapsedMs >= entry.ms) progress = entry.progress;
  }
  return progress;
};

const getTimeBasedStageIndex = (elapsedMs) => {
  let index = 0;
  for (let i = 0; i < LOADING_STAGE_TIME_MS.length && i < loadingStages.length; i += 1) {
    if (elapsedMs >= LOADING_STAGE_TIME_MS[i]) index = i;
  }
  return index;
};

const advanceLoadingStageIndex = (candidateIndex) => {
  if (candidateIndex < 0) return loadingMaxStageIndex;
  loadingMaxStageIndex = Math.max(loadingMaxStageIndex, candidateIndex);
  return loadingMaxStageIndex;
};

const getActiveLoadingStage = () => loadingStages[loadingMaxStageIndex] || loadingStages[0];

const setExportButtonsEnabled = (enabled) => {
  exportMarkdownButton.disabled = !enabled;
  exportJsonButton.disabled = !enabled;
  exportPackageButton.disabled = !enabled;
};

const renderLoadingSteps = (activeStageId) => {
  if (!loadingSteps) return;
  const activeIndex = loadingStages.findIndex((stage) => stage.id === activeStageId);
  loadingSteps.replaceChildren(
    ...loadingStages.map((stage, index) => {
      const item = document.createElement("li");
      item.textContent = stage.label;
      if (activeIndex >= 0 && index < activeIndex) item.classList.add("is-done");
      if (index === activeIndex) item.classList.add("is-active");
      return item;
    }),
  );
};

const updateLoadingProgress = (activeStageId, progress, label = "") => {
  const stageIndex = loadingStages.findIndex((stage) => stage.id === activeStageId);
  const stage = stageIndex >= 0 ? loadingStages[stageIndex] : loadingStages[loadingStages.length - 1];
  const clamped = Math.max(0, Math.min(100, progress));
  if (loadingStage) loadingStage.textContent = `${label || stage?.label || "Working"}...`;
  if (loadingPercent) loadingPercent.textContent = `${Math.round(clamped)}%`;
  if (loadingProgressBar) loadingProgressBar.style.width = `${clamped}%`;
  if (loadingProgressTrack) loadingProgressTrack.setAttribute("aria-valuenow", String(Math.round(clamped)));
};

const applyLoadingProgress = ({ stageId, label, progress, detail = "" }, { fromServer = false } = {}) => {
  if (!stageId) return;
  if (fromServer) loadingServerSynced = true;
  const resolvedProgress = resolveStageProgress(stageId, progress);
  const stageIndex = loadingStages.findIndex((item) => item.id === stageId);
  advanceLoadingStageIndex(stageIndex);
  const activeStage = getActiveLoadingStage();
  loadingActiveStageId = activeStage?.id || stageId;
  loadingActiveLabel = label || activeStage?.label || "";
  loadingTargetProgress = Math.max(loadingTargetProgress, resolvedProgress);
  loadingProgressValue = Math.max(loadingProgressValue, resolvedProgress);
  renderLoadingSteps(loadingActiveStageId);
  updateLoadingProgress(loadingActiveStageId, loadingProgressValue, loadingActiveLabel);
  const loadingHint = document.querySelector(".loading-hint");
  if (loadingHint) {
    loadingHint.textContent = detail || "Crawling pages and generating strategy — usually 30s to 2 min.";
  }
};

const stopLoadingAnimation = () => {
  if (loadingProgressTimer) {
    window.clearInterval(loadingProgressTimer);
    loadingProgressTimer = null;
  }
  loadingServerSynced = false;
  loadingMaxStageIndex = 0;
};

const startLoadingProgressTween = () => {
  if (loadingProgressTimer) return;
  loadingProgressTimer = window.setInterval(() => {
    const elapsed = Date.now() - loadingStartedAt;
    const simulatedTarget = getSimulatedLoadingProgress(elapsed);
    const effectiveTarget = Math.max(loadingTargetProgress, simulatedTarget);
    advanceLoadingStageIndex(getTimeBasedStageIndex(elapsed));

    const activeStage = getActiveLoadingStage();
    if (activeStage && activeStage.id !== loadingActiveStageId) {
      loadingActiveStageId = activeStage.id;
      loadingActiveLabel = activeStage.label;
      renderLoadingSteps(loadingActiveStageId);
    }

    if (loadingProgressValue < effectiveTarget) {
      const step = Math.max(0.35, (effectiveTarget - loadingProgressValue) * 0.12);
      loadingProgressValue = Math.min(effectiveTarget, loadingProgressValue + step);
    }
    updateLoadingProgress(loadingActiveStageId, loadingProgressValue, loadingActiveLabel);
  }, 60);
};

const startLoadingAnimation = (includeDraft = false) => {
  stopLoadingAnimation();
  loadingStages = getVisibleProgressStages(includeDraft);
  loadingProgressValue = 0;
  loadingTargetProgress = 0;
  loadingMaxStageIndex = 0;
  loadingStartedAt = Date.now();
  loadingServerSynced = false;
  loadingActiveStageId = loadingStages[0]?.id || "discover";
  loadingActiveLabel = loadingStages[0]?.label || "";
  renderLoadingSteps(loadingActiveStageId);
  updateLoadingProgress(loadingActiveStageId, 0);
  const loadingHint = document.querySelector(".loading-hint");
  if (loadingHint) {
    loadingHint.textContent = "Crawling pages and generating strategy — usually 30s to 2 min.";
  }
  startLoadingProgressTween();
};

const finishLoadingAnimation = () =>
  new Promise((resolve) => {
    stopLoadingAnimation();
    const finalStage = loadingStages[loadingStages.length - 1];
    renderLoadingSteps(finalStage?.id || "finalize");
    loadingTargetProgress = 100;

    const tick = () => {
      if (loadingProgressValue >= 99.5) {
        updateLoadingProgress(finalStage?.id || "finalize", 100, finalStage?.label);
        window.setTimeout(resolve, 220);
        return;
      }
      loadingProgressValue = Math.min(100, loadingProgressValue + Math.max(1.2, (100 - loadingProgressValue) * 0.12));
      updateLoadingProgress(finalStage?.id || "finalize", loadingProgressValue, finalStage?.label);
      window.requestAnimationFrame(tick);
    };
    window.requestAnimationFrame(tick);
  });

const setAppPhase = (phase) => {
  appPhase = phase;
  document.body.classList.toggle("is-landing", phase === "landing");
  document.body.classList.toggle("is-loading", phase === "loading");
  document.body.classList.toggle("is-workspace", phase === "workspace");
  loadingView.hidden = phase !== "loading";
  if (phase !== "loading") stopLoadingAnimation();
  setExportButtonsEnabled(phase === "workspace" && Boolean(currentWorkflow));
};

const enterWorkspace = (workflow, options = {}) => {
  const preparedWorkflow = normalizeWorkflow(workflow, workflow.inputs || getInputs());
  renderWorkflow(preparedWorkflow, options);
  setAppPhase("workspace");
};

const enterLanding = () => {
  currentWorkflow = null;
  setAppPhase("landing");
};

const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const safeExternalUrl = (value) => {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
};

const currentPlanLength = () => normalizePlanLength(planLengthInput?.value);

const syncPlanLengthLabel = () => {
  if (!planLengthInput || !planLengthValue) return;
  const value = currentPlanLength();
  planLengthInput.value = String(value);
  planLengthValue.textContent = `${value} topic${value === 1 ? "" : "s"}`;
};

const getInputs = () => {
  const saved = currentWorkflow?.inputs || {};
  return {
    rawUrl: websiteUrl.value.trim(),
    url: websiteUrl.value.trim() || saved.url || "",
    domain: parseDomain(websiteUrl.value.trim() || saved.url || ""),
    category: saved.category || "software product",
    audience: saved.audience || "target audience",
    goal: saved.goal || "start a trial",
    voice: voice.value || saved.voice || "sharp",
    planLength: normalizePlanLength(planLengthInput?.value || saved.planLength),
    includeDraft: includeDraftInput ? includeDraftInput.checked : Boolean(saved.includeDraft),
  };
};

const getAiInput = ({ includeDraft = Boolean(includeDraftInput?.checked) } = {}) => ({
  rawUrl: websiteUrl.value.trim(),
  url: websiteUrl.value.trim(),
  domain: parseDomain(websiteUrl.value.trim()),
  category: "",
  audience: "",
  goal: "",
  voice: voice.value,
  planLength: currentPlanLength(),
  includeDraft,
});

const generateAiWorkflow = (options = {}) => {
  const inputs = getAiInput(options);
  return requestAiWorkflow(inputs, {
    onProgress: (event) => applyLoadingProgress(event, { fromServer: true }),
  });
};

const readNdjsonResponse = async (response, onEvent) => {
  if (!response.body) {
    throw new Error("Streaming response body is missing.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completePayload = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const event = JSON.parse(trimmed);
      if (event.type === "progress") {
        onEvent?.(event);
        continue;
      }
      if (event.type === "error") {
        throw new Error(event.error || "AI generation failed.");
      }
      if (event.type === "complete") {
        completePayload = event;
      }
    }
  }

  const trailing = buffer.trim();
  if (trailing) {
    const event = JSON.parse(trailing);
    if (event.type === "error") {
      throw new Error(event.error || "AI generation failed.");
    }
    if (event.type === "complete") {
      completePayload = event;
    }
  }

  if (!completePayload) {
    throw new Error("AI generation ended without a result.");
  }
  return completePayload;
};

const requestAiWorkflow = async (inputs, { onProgress } = {}) => {
  const response = await fetchWithTimeout(
    "/api/generate",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/x-ndjson",
      },
      body: JSON.stringify(inputs),
    },
    ANALYZE_TIMEOUT_MS,
  );

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `AI generation failed with HTTP ${response.status}`);
  }

  const payload = await readNdjsonResponse(response, onProgress);
  currentProvider = {
    provider: payload.provider,
    model: payload.model,
    fallbackReason: payload.fallbackReason || null,
  };
  if (payload.usage) addHistory("Analyze site", payload.usage, payload.model);
  return {
    workflow: normalizeWorkflow(payload.workflow, inputs),
    fallbackReason: payload.fallbackReason || null,
    draftFallbackReason: payload.draftFallbackReason || null,
  };
};

const appendDraftToWorkflow = (draft) => {
  currentWorkflow = {
    ...currentWorkflow,
    drafts: [...currentWorkflow.drafts, draft],
  };
  currentWorkflow = persistWorkflow(currentWorkflow);
  renderCalendar(currentWorkflow);
  renderDrafts(currentWorkflow, currentWorkflow.drafts.length - 1);
  selectTab("draft");
};

const replaceDraftInWorkflow = (index, draft) => {
  const drafts = [...currentWorkflow.drafts];
  drafts[index] = draft;
  currentWorkflow = {
    ...currentWorkflow,
    drafts,
  };
  currentWorkflow = persistWorkflow(currentWorkflow);
  renderCalendar(currentWorkflow);
  renderDrafts(currentWorkflow, index);
};

const findCalendarItemForDraft = (draft) => {
  if (!currentWorkflow?.calendar?.length || !draft?.title) return null;
  return currentWorkflow.calendar.find((item) => item.title === draft.title) || null;
};

const updateRegenerateDraftButton = () => {
  if (!regenerateDraftButton) return;
  regenerateDraftButton.disabled = !currentWorkflow?.drafts?.length;
};

const DRAFT_STAGE_LABELS = ["Planning…", "Composing…", "Writing…", "Auditing…", "Revising…"];

const runDraftStageProgress = (button, initialLabel = "Generating") => {
  if (!button) return () => {};
  let index = 0;
  button.textContent = DRAFT_STAGE_LABELS[index];
  const timer = setInterval(() => {
    index = Math.min(index + 1, DRAFT_STAGE_LABELS.length - 1);
    button.textContent = DRAFT_STAGE_LABELS[index];
  }, 3500);
  return () => {
    clearInterval(timer);
    button.textContent = initialLabel;
  };
};

const requestDraftFromApi = async (calendarItem, { replaceIndex, progressButton } = {}) => {
  const existingTitles = currentWorkflow.drafts
    .map((draft) => draft.title)
    .filter((_, index) => replaceIndex === undefined || index !== replaceIndex);

  const stopProgress = runDraftStageProgress(progressButton);
  let response;
  try {
    response = await fetchWithTimeout(
      "/api/draft",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: getInputs(),
          calendarItem,
          existingTitles,
        }),
      },
      DRAFT_TIMEOUT_MS,
    );
  } finally {
    stopProgress();
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Draft generation failed with HTTP ${response.status}`);
  }
  currentProvider = {
    provider: payload.provider,
    model: payload.model,
    fallbackReason: payload.fallbackReason || null,
  };
  const historyLabel =
    replaceIndex === undefined
      ? `Generate draft: ${calendarItem.title}`
      : `Regenerate draft: ${calendarItem.title}`;
  if (payload.usage) addHistory(historyLabel, payload.usage, payload.model);

  const draft = normalizeDraft(payload.draft, {
    calendarItem,
    siteContext: currentWorkflow?.siteContext,
    inputs: getInputs(),
  });
  if (payload.draftRuntime && !draft.draftRuntime) {
    draft.draftRuntime = payload.draftRuntime;
  } else if (payload.draft?.draftRuntime) {
    draft.draftRuntime = payload.draft.draftRuntime;
  }
  if (!draft.placementUrl) {
    draft.placementUrl = inferPlacementUrl(
      draft.placement,
      currentWorkflow.siteContext,
      getInputs(),
      calendarItem,
    );
  }
  if (replaceIndex === undefined) {
    appendDraftToWorkflow(draft);
  } else {
    replaceDraftInWorkflow(replaceIndex, draft);
  }
  renderWorkflowBanner();
  showToast(
    payload.fallbackReason
      ? payload.fallbackReason
      : replaceIndex === undefined
        ? "Draft added"
        : "Draft regenerated",
  );
  return draft;
};

const generateDraftForCalendarItem = async (calendarItem, button) => {
  if (!currentWorkflow?.siteContext?.ok) {
    showToast("Re-analyze the site before generating drafts.");
    return;
  }
  if (calendarItem.hasQaFailures) {
    showToast("Fix the calendar title or keyword before generating this draft.");
    return;
  }
  button.disabled = true;
  try {
    await requestDraftFromApi(calendarItem, { progressButton: button });
  } catch (error) {
    showToast(formatDraftError(error));
  } finally {
    const added = currentWorkflow?.drafts?.some((draft) => draft.title === calendarItem.title);
    if (!added) {
      button.disabled = false;
      button.textContent = "Generate";
    }
  }
};

const applyAssumptions = (workflow) => {
  const inputs = workflow.inputs || {};
  voice.value = inputs.voice && voiceRules[inputs.voice] ? inputs.voice : "";
  if (includeDraftInput) includeDraftInput.checked = Boolean(inputs.includeDraft);
  if (planLengthInput) {
    planLengthInput.value = String(normalizePlanLength(inputs.planLength));
    syncPlanLengthLabel();
  }
};

const renderProviderDetailRow = (label, value, copyValue = "") => {
  const row = document.createElement("div");
  const dt = document.createElement("dt");
  const dd = document.createElement("dd");
  dt.textContent = label;
  dd.textContent = value || "—";
  row.append(dt, dd);
  if (copyValue) {
    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = "copy-path-btn";
    copyButton.textContent = "Copy";
    copyButton.addEventListener("click", async () => {
      await navigator.clipboard.writeText(copyValue);
      showToast("Copied to clipboard");
    });
    row.append(copyButton);
  }
  return row;
};

const refreshProviderStatus = async () => {
  try {
    const response = await fetch("/api/provider/status");
    const status = await response.json();
    const configured = Boolean(status.configured);
    providerCard.classList.toggle("is-ready", configured);
    providerCard.classList.toggle("is-missing", !configured);
    providerStatusText.textContent = configured
      ? "Codex OAuth ready"
      : status.message || "Codex OAuth is not configured";
    providerDetails.replaceChildren();
    if (configured) {
      providerDetails.append(
        renderProviderDetailRow("Model", status.activeModel || status.defaultModel || "gpt-5.5"),
        renderProviderDetailRow("Auth", status.authMode || "chatgpt"),
        renderProviderDetailRow("Home", status.codexHome || "~/.codex", status.codexHome),
        renderProviderDetailRow("Auth file", status.authPath || "auth.json", status.authPath),
      );
    } else if (status.codexHome || status.authPath) {
      providerDetails.append(
        renderProviderDetailRow("Home", status.codexHome || "~/.codex", status.codexHome),
        renderProviderDetailRow("Auth file", status.authPath || "auth.json", status.authPath),
      );
    }
  } catch {
    providerCard.classList.add("is-missing");
    providerCard.classList.remove("is-ready");
    providerStatusText.textContent = "Local AI server not detected. Rule-based generation is still available.";
    providerDetails.replaceChildren();
  }
};

const renderDefinitionList = (items) => {
  strategyProfile.replaceChildren(
    ...items.flatMap(([term, description]) => {
      const dt = document.createElement("dt");
      const dd = document.createElement("dd");
      dt.textContent = term;
      dd.textContent = description;
      return [dt, dd];
    }),
  );
};

const formatUsage = (usage) => {
  if (!usage) return "tokens: unavailable";
  const total = usage.total_tokens ?? "unknown";
  const input = usage.input_tokens ?? "?";
  const output = usage.output_tokens ?? "?";
  return `${usage.estimated ? "~" : ""}${total} tokens (${input} in / ${output} out)`;
};

const addHistory = (action, usage, model) => {
  actionHistory = [
    {
      action,
      model: model || currentProvider?.model || "unknown",
      usage,
      time: new Date().toLocaleTimeString(),
    },
    ...actionHistory,
  ].slice(0, 30);
  renderHistory();
};

const renderHistory = () => {
  if (!historyList) return;
  if (actionHistory.length === 0) {
    historyList.innerHTML = `<article class="history-item"><strong>No AI actions yet</strong><p>Analyze a site or generate a draft to see model and token usage here.</p></article>`;
    return;
  }
  historyList.replaceChildren(
    ...actionHistory.map((entry) => {
      const item = document.createElement("article");
      item.className = "history-item";
      item.innerHTML = `
        <div>
          <strong>${escapeHtml(entry.action)}</strong>
          <p>${escapeHtml(entry.time)} · ${escapeHtml(entry.model)}</p>
        </div>
        <span>${escapeHtml(formatUsage(entry.usage))}</span>
      `;
      return item;
    }),
  );
};

const persistWorkflow = (workflow) => {
  const record = createProjectRecord(workflow, currentProvider);
  projectRecords = upsertProjectRecord(projectRecords, record);
  if (!writeProjectRecords(window.localStorage, projectRecords)) {
    showToast("Local project storage is full or unavailable");
  }
  renderProjects();
  return record.workflow;
};

const renderProjects = () => {
  if (!projectList) return;
  if (projectRecords.length === 0) {
    projectList.innerHTML = `<article class="project-card"><strong>No saved projects yet</strong><p>AI-generated workspaces are saved locally in this browser after analysis.</p></article>`;
    return;
  }

  projectList.innerHTML = projectRecords
    .map(
      (record) => `
        <article class="project-card">
          <div>
            <p class="eyebrow">${escapeHtml(record.domain || "website")}</p>
            <h3>${escapeHtml(record.title)}</h3>
            <p>${escapeHtml(record.url)} · ${escapeHtml(record.pageCount)} pages · ${escapeHtml(record.provider?.model || "local")}</p>
            <span>Updated ${escapeHtml(formatSavedAt(record.updatedAt || record.savedAt))}</span>
          </div>
          <div class="project-actions">
            <button class="mini-action" type="button" data-load-project="${escapeHtml(record.id)}">Load</button>
            <button class="mini-action" type="button" data-export-project="${escapeHtml(record.id)}">Export</button>
            <button class="mini-action danger-action" type="button" data-remove-project="${escapeHtml(record.id)}">Remove</button>
          </div>
        </article>
      `,
    )
    .join("");
};

const renderWorkflowBanner = () => {
  if (!workflowBanner) return;
  const crawlFailed = currentWorkflow?.siteContext && currentWorkflow.siteContext.ok === false;
  const isLocal = currentProvider?.provider === "local-rules";
  const reason = currentProvider?.fallbackReason;
  if (!isLocal && !reason && !crawlFailed) {
    workflowBanner.hidden = true;
    workflowBanner.textContent = "";
    return;
  }
  workflowBanner.hidden = false;
  workflowBanner.classList.toggle("is-error", crawlFailed || /usage limit|failed/i.test(reason || ""));
  if (crawlFailed) {
    const crawlIssue = describeSiteCrawlIssue(currentWorkflow.siteContext);
    const requestedUrl = currentWorkflow.siteContext.requestedStartUrl || currentWorkflow.inputs?.url || "";
    const crawledUrl = currentWorkflow.siteContext.startUrl || "";
    const urlHint =
      requestedUrl && crawledUrl && requestedUrl !== crawledUrl
        ? ` Crawled ${crawledUrl} after ${requestedUrl} failed.`
        : "";
    workflowBanner.innerHTML = `
      <strong>${escapeHtml(crawlIssue?.title || "Site crawl did not succeed — workspace needs review")}</strong>
      <span>${escapeHtml(crawlIssue?.message || currentWorkflow.siteContext.error || "Re-analyze the site before generating drafts or exporting content.")}${escapeHtml(urlHint)} ${escapeHtml(crawlIssue?.hint || "")}</span>
    `;
    return;
  }
  workflowBanner.innerHTML = `
    <strong>Local template output — not full AI generation</strong>
    <span>${escapeHtml(reason || "Codex AI was unavailable, so this workflow uses local rules plus any crawled site data.")}</span>
  `;
};

const renderStrategy = (workflow) => {
  projectTitle.textContent = `${workflow.inputs.domain} planning workspace`;
  renderWorkflowBanner();
  renderDefinitionList([
    ["Positioning", workflow.strategy.positioning],
    ["Customer", workflow.strategy.customer],
    ["Promise", workflow.strategy.promise],
    ["Voice", workflow.strategy.voice],
    ["Content gap", workflow.strategy.contentGap],
    ["Plan rule", workflow.strategy.publishingRule],
  ]);
  const planLength = normalizePlanLength(workflow.inputs?.planLength);
  machineSummary.textContent = `This local workspace turns ${workflow.inputs.domain} into site context, search themes, a ${planLength}-topic content plan, draft outlines, and a review checklist.${
    currentProvider?.provider === "codex-oauth"
      ? ` Generated through ${currentProvider.provider} (${currentProvider.model}).`
      : currentProvider?.provider === "local-rules"
        ? " The current view is a local template because Codex AI did not complete successfully."
        : ""
  }`;

  let refreshPanel = document.querySelector("#refresh-queue-panel");
  if (!refreshPanel) {
    refreshPanel = document.createElement("article");
    refreshPanel.id = "refresh-queue-panel";
    refreshPanel.className = "panel-block refresh-queue-panel";
    document.querySelector("#strategy")?.appendChild(refreshPanel);
  }

  const candidates = workflow.strategy.refreshCandidates || [];
  refreshPanel.innerHTML = `
    <h3>Refresh queue</h3>
    ${
      candidates.length
        ? `<ul class="refresh-queue-list">${candidates
            .map(
              (item) => `
                <li class="refresh-queue-item is-${escapeHtml(item.priority || "medium")}">
                  <strong>${renderPageLink(item.url, item.title)}</strong>
                  <span class="refresh-meta">${escapeHtml(item.pageType || "page")}${item.lastmod ? ` · lastmod ${escapeHtml(item.lastmod)}` : ""}</span>
                  <p>${escapeHtml(item.reasons?.join(" ") || "")}</p>
                </li>
              `,
            )
            .join("")}</ul>`
        : `<p>No stale pages were flagged from sitemap dates or title signals. Net-new planning can proceed.</p>`
    }
  `;
};

const renderPageLink = (url, label = url) => {
  const safeUrl = safeExternalUrl(url);
  return safeUrl
    ? `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noreferrer">${escapeHtml(label || safeUrl)}</a>`
    : escapeHtml(label || url || "");
};

const renderSiteCoverage = (workflow) => {
  const context = workflow.siteContext || {};
  const discovery = context.discovery || {};
  const summary = context.summary || {};
  const audit = auditSitePages(context);
  const pageTypes = Object.entries(summary.pageTypes || {})
    .map(([type, count]) => `${type}: ${count}`)
    .join(" · ");
  const sitemapLinks = (discovery.sitemaps || [])
    .slice(0, 4)
    .map((url) => `<li>${renderPageLink(url)}</li>`)
    .join("");
  const pageCards = (context.pages || [])
    .slice(0, 30)
    .map((page) => {
      const title = page.title || page.h1 || page.url;
      const heading = page.h1 && page.h1 !== title ? `<p>${escapeHtml(page.h1)}</p>` : "";
      return `
        <article class="site-page-card">
          <div>
            <span class="site-page-type">${escapeHtml(page.pageType || "page")}</span>
            <h3>${renderPageLink(page.url, title)}</h3>
            ${heading}
            <p>${escapeHtml(page.metaDescription || page.pageText || "No page summary extracted.")}</p>
          </div>
          <span>${escapeHtml(page.wordCount || 0)} words</span>
        </article>
      `;
    })
    .join("");
  const failures = (context.failures || [])
    .slice(0, 8)
    .map((failure) => `<li>${renderPageLink(failure.url)} <em>${escapeHtml(failure.reason || "Fetch failed")}</em></li>`)
    .join("");
  const events = (context.events || [])
    .slice(-12)
    .map(
      (event) => `
        <li class="crawl-event is-${escapeHtml(event.status || "warn")}">
          <span>${escapeHtml(event.type || "event")}</span>
          ${event.url ? renderPageLink(event.url, event.url) : ""}
          <em>${escapeHtml(event.detail || "")}</em>
        </li>
      `,
    )
    .join("");

  const siteIssueList = (audit.siteIssues || [])
    .map(
      (issue) =>
        `<li class="audit-issue is-${escapeHtml(issue.severity)}">${escapeHtml(issue.message)}${issue.detail ? ` <em>${escapeHtml(issue.detail)}</em>` : ""}</li>`,
    )
    .join("");
  const pageIssueList = (audit.topIssues || [])
    .filter((entry) => entry.issueCount > 0)
    .map(
      (entry) => `
        <article class="audit-page-card">
          <div>
            <span class="site-page-type">${escapeHtml(entry.pageType || "page")}</span>
            <h4>${renderPageLink(entry.url, entry.title)}</h4>
          </div>
          <ul class="audit-issue-list">${entry.issues
            .map((issue) => `<li class="audit-issue is-${escapeHtml(issue.severity)}">${escapeHtml(issue.message)}</li>`)
            .join("")}</ul>
        </article>
      `,
    )
    .join("");

  siteCoverage.innerHTML = `
    <div class="coverage-summary-grid">
      <article class="coverage-metric">
        <span>Strategy</span>
        <strong>${escapeHtml(discovery.strategy || "unknown")}</strong>
      </article>
      <article class="coverage-metric">
        <span>Pages fetched</span>
        <strong>${escapeHtml(discovery.pagesFetched ?? summary.pageCount ?? 0)}</strong>
      </article>
      <article class="coverage-metric">
        <span>Discovered</span>
        <strong>${escapeHtml(discovery.pagesDiscovered ?? 0)}</strong>
      </article>
      <article class="coverage-metric">
        <span>Failures</span>
        <strong>${escapeHtml(discovery.pagesFailed ?? 0)}</strong>
      </article>
    </div>

    <div class="coverage-actions">
      <button class="secondary-action" type="button" data-reanalyze-site>Re-analyze site</button>
    </div>

    <article class="panel-block page-audit-panel">
      <h3>On-page and technical issues</h3>
      <div class="coverage-summary-grid">
        <article class="coverage-metric">
          <span>Pages audited</span>
          <strong>${escapeHtml(audit.pagesAudited || 0)}</strong>
        </article>
        <article class="coverage-metric">
          <span>Pages with issues</span>
          <strong>${escapeHtml(audit.pagesWithIssues || 0)}</strong>
        </article>
        <article class="coverage-metric">
          <span>Warnings</span>
          <strong>${escapeHtml(audit.issueCounts?.warn || 0)}</strong>
        </article>
        <article class="coverage-metric">
          <span>Failures</span>
          <strong>${escapeHtml(audit.issueCounts?.fail || 0)}</strong>
        </article>
      </div>
      ${siteIssueList ? `<ul class="audit-issue-list site-audit-issues">${siteIssueList}</ul>` : ""}
      <div class="audit-page-list">${pageIssueList || `<p>No per-page on-page issues detected in crawled pages.</p>`}</div>
    </article>

    <div class="split-grid site-detail-grid">
      <article class="panel-block">
        <h3>Crawl sources</h3>
        <dl class="definition-list">
          <dt>Start URL</dt>
          <dd>${renderPageLink(context.startUrl || workflow.inputs.url)}</dd>
          <dt>Robots</dt>
          <dd>${discovery.robotsUrl ? renderPageLink(discovery.robotsUrl, discovery.robotsOk ? "available" : "not available") : "Not checked"}</dd>
          <dt>Sitemaps</dt>
          <dd>${sitemapLinks ? `<ul class="compact-link-list">${sitemapLinks}</ul>` : "No sitemap URLs found"}</dd>
          <dt>Page types</dt>
          <dd>${escapeHtml(pageTypes || "No page types extracted")}</dd>
        </dl>
        ${context.ok ? "" : `<p class="coverage-warning">${escapeHtml(context.error || "No crawl coverage available.")}</p>`}
      </article>
      <article class="panel-block">
        <h3>Reference images</h3>
        ${
          summary.referenceImages?.length
            ? `<ul class="compact-link-list">${summary.referenceImages
                .slice(0, 8)
                .map((image) => `<li>${renderPageLink(image.url, image.reason || image.alt || image.url)}</li>`)
                .join("")}</ul>`
            : `<p>No useful image references were extracted from crawled pages.</p>`
        }
      </article>
    </div>

    <div class="site-page-list">${pageCards || `<article class="site-page-card"><p>No crawled pages to show.</p></article>`}</div>
    ${
      events
        ? `<article class="panel-block crawl-events"><h3>Crawl timeline</h3><ul class="compact-link-list">${events}</ul></article>`
        : ""
    }
    ${
      failures
        ? `<article class="panel-block crawl-failures"><h3>Fetch issues</h3><ul class="compact-link-list">${failures}</ul></article>`
        : ""
    }
  `;
};

const renderKeywords = (workflow) => {
  keywordList.replaceChildren(
    ...workflow.keywords.map((keyword) => {
      const card = document.createElement("article");
      card.className = "keyword-card";
      const questions = Array.isArray(keyword.questionVariants) ? keyword.questionVariants : [];
      card.innerHTML = `
        <p class="eyebrow">${escapeHtml(keyword.intent)} intent</p>
        <h3>${escapeHtml(keyword.keyword)}</h3>
        <div class="metric-row">
          <span class="metric">Value ${escapeHtml(keyword.commercialValue)}/5</span>
          <span class="metric">Ease ${escapeHtml(6 - keyword.difficulty)}/5</span>
          <span class="metric">Fit ${escapeHtml(keyword.productFit)}/5</span>
        </div>
        ${
          questions.length
            ? `<div class="question-variants"><p class="eyebrow">Question keywords</p><ul>${questions
                .map((question) => `<li>${escapeHtml(question)}</li>`)
                .join("")}</ul></div>`
            : ""
        }
      `;
      return card;
    }),
  );
};

const renderCalendar = (workflow) => {
  const draftTitles = new Set(workflow.drafts.map((draft) => draft.title));
  let summaryPanel = document.querySelector("#calendar-audit-panel");
  if (!summaryPanel) {
    summaryPanel = document.createElement("article");
    summaryPanel.id = "calendar-audit-panel";
    summaryPanel.className = "panel-block calendar-audit-panel";
    calendarList.before(summaryPanel);
  }

  const audit = workflow.calendarAudit || {};
  const failedItems = (workflow.calendar || []).filter((item) => item.hasQaFailures);
  summaryPanel.innerHTML = `
    <h3>Content plan review</h3>
    <p>${escapeHtml(audit.total || workflow.calendar.length)} topics planned · ${escapeHtml(audit.failures || failedItems.length)} need title or keyword fixes · ${escapeHtml(audit.warnings || 0)} warnings</p>
    ${
      failedItems.length
        ? `<ul class="calendar-audit-list">${failedItems
            .slice(0, 6)
            .map((item) => {
              const issue = (item.qaChecks || []).find((check) => check.status === "fail");
              const suggestion = item.suggestedTitle ? ` Suggested: ${item.suggestedTitle}` : "";
              return `<li><strong>Day ${escapeHtml(item.day)}</strong>: ${escapeHtml(issue?.detail || "Needs review")}${escapeHtml(suggestion)}</li>`;
            })
            .join("")}</ul>`
        : `<p>All calendar titles pass the audience-facing headline check.</p>`
    }
  `;

  calendarList.replaceChildren(
    ...workflow.calendar.map((item, index) => {
      const alreadyGenerated = draftTitles.has(item.title);
      const failedCheck = (item.qaChecks || []).find((check) => check.status === "fail");
      const warnCheck = (item.qaChecks || []).find((check) => check.status === "warn");
      const qaLabel = failedCheck ? "Needs fix" : warnCheck ? "Review" : "Ready";
      const qaClass = failedCheck ? "is-fail" : warnCheck ? "is-warn" : "is-pass";
      const row = document.createElement("article");
      row.className = `calendar-item${failedCheck ? " has-calendar-fail" : ""}`;
      row.dataset.index = String(index);
      row.innerHTML = `
        <span class="day-pill">Day ${escapeHtml(item.day)}</span>
        <div>
          <strong>${escapeHtml(item.title)}</strong>
          <p>${escapeHtml(item.keyword)}${item.placement ? ` · ${escapeHtml(item.placement)}` : ""}</p>
          ${item.suggestedTitle ? `<p class="calendar-suggestion">Suggested title: ${escapeHtml(item.suggestedTitle)}</p>` : ""}
        </div>
        <div class="calendar-actions">
          <span class="calendar-qa ${qaClass}">${escapeHtml(qaLabel)}</span>
          <span class="intent-pill">${escapeHtml(item.intent)} · ${escapeHtml(item.format)}</span>
          <button class="mini-action" type="button" data-generate-draft="${index}" ${alreadyGenerated || failedCheck ? "disabled" : ""}>
            ${alreadyGenerated ? "Added" : failedCheck ? "Fix first" : "Generate"}
          </button>
        </div>
      `;
      return row;
    }),
  );
};

const renderEvidenceRef = (ref) => {
  const label = ref.pageTitle || ref.source || ref.url || "website";
  const source = ref.url ? renderPageLink(ref.url, label) : `<strong>${escapeHtml(label)}</strong>`;
  return `<li>${source}: ${escapeHtml(ref.quote)} <em>${escapeHtml(ref.usedFor)}</em></li>`;
};

const renderReferenceImages = (images = []) =>
  images.length
    ? `<ul class="compact-link-list">${images
        .map((image) => `<li>${renderPageLink(image.url, image.reason || image.url)}</li>`)
        .join("")}</ul>`
    : `<p>No reference images required.</p>`;

const renderDraftBlock = (block) => {
  const type = block.type || "section";
  if (type === "hero") {
    return `
      <section class="draft-block draft-block-hero">
        <p class="eyebrow">Hero</p>
        <h4>${escapeHtml(block.heading || "")}</h4>
        ${block.subheading ? `<p class="draft-subheading">${escapeHtml(block.subheading)}</p>` : ""}
        <p>${escapeHtml(block.body || "")}</p>
        <p class="draft-cta-row"><strong>${escapeHtml(block.primaryCta || "")}</strong>${block.secondaryCta ? ` · ${escapeHtml(block.secondaryCta)}` : ""}</p>
      </section>`;
  }
  if (type === "steps") {
    return `
      <section class="draft-block draft-block-steps">
        <p class="eyebrow">How it works</p>
        <ol>${(block.items || [])
          .map((item) => `<li><strong>${escapeHtml(item.title || "")}</strong><p>${escapeHtml(item.body || "")}</p></li>`)
          .join("")}</ol>
      </section>`;
  }
  if (type === "features" || type === "useCases") {
    return `
      <section class="draft-block draft-block-${escapeHtml(type)}">
        <p class="eyebrow">${type === "features" ? "Features" : "Use cases"}</p>
        <ul>${(block.items || [])
          .map((item) => `<li><strong>${escapeHtml(item.title || item.label || "")}</strong><p>${escapeHtml(item.body || item.summary || "")}</p></li>`)
          .join("")}</ul>
      </section>`;
  }
  if (type === "comparison") {
    return `
      <section class="draft-block draft-block-comparison">
        <p class="eyebrow">Comparison</p>
        <ul>${(block.items || [])
          .map((item) => `<li><strong>${escapeHtml(item.label || "")}</strong><p>${escapeHtml(item.summary || "")}</p></li>`)
          .join("")}</ul>
      </section>`;
  }
  if (type === "verdict" || type === "intro") {
    return `
      <section class="draft-block draft-block-${escapeHtml(type)}">
        <h4>${escapeHtml(block.heading || "")}</h4>
        <p>${escapeHtml(block.body || "")}</p>
      </section>`;
  }
  if (type === "faq") {
    return `
      <section class="draft-block draft-block-faq">
        <h4>FAQ</h4>
        <ul>${(block.items || [])
          .map((item) => `<li><strong>${escapeHtml(item.question || "")}</strong> ${escapeHtml(item.answer || "")}</li>`)
          .join("")}</ul>
      </section>`;
  }
  if (type === "cta") {
    return `
      <section class="draft-block draft-block-cta">
        <h4>${escapeHtml(block.heading || "CTA")}</h4>
        <p>${escapeHtml(block.body || "")}</p>
        ${block.buttonText ? `<p><strong>${escapeHtml(block.buttonText)}</strong></p>` : ""}
      </section>`;
  }
  return `
    <section class="draft-block">
      <h4>${escapeHtml(block.heading || type)}</h4>
      <p>${escapeHtml(block.body || "")}</p>
    </section>`;
};

const renderDraftIntentSummary = (draft) => {
  const intent = draft.draftRuntime?.intent;
  if (!intent) return "";
  const outline = (intent.sectionOutline || [])
    .map((section) => `<li><strong>${escapeHtml(section.purpose || section.id)}</strong>${section.transitionFrom ? ` — ${escapeHtml(section.transitionFrom)}` : ""}</li>`)
    .join("");
  return `
  <details class="draft-intent-panel">
    <summary>Writing intent</summary>
    <p><strong>Angle:</strong> ${escapeHtml(intent.angle || "")}</p>
    <p><strong>Reader problem:</strong> ${escapeHtml(intent.readerProblem || "")}</p>
    ${outline ? `<ol class="draft-intent-outline">${outline}</ol>` : ""}
  </details>`;
};

const draftToHtml = (draft) => {
  const hasBlocks = Array.isArray(draft.blocks) && draft.blocks.length > 0;
  const bodyHtml = hasBlocks
    ? draft.blocks.map((block) => renderDraftBlock(block)).join("")
    : (draft.sections || [])
        .map(
          (section) => `
        <h4>${escapeHtml(section.heading)}</h4>
        <p>${escapeHtml(section.body)}</p>
      `,
        )
        .join("");
  const tailHtml =
    hasBlocks || !draft.faq?.length
      ? ""
      : `<h4>FAQ</h4><ul>${draft.faq.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
  const ctaHtml = hasBlocks || !draft.cta ? "" : `<h4>CTA</h4><p>${escapeHtml(draft.cta)}</p>`;
  const auditBanner =
    draft.templateAudit?.hasFailures || draft.qaChecks?.some((check) => check.status === "fail")
      ? `<div class="draft-audit-banner">Template or URL checks failed. Review Draft QA before export.</div>`
      : "";

  return `
  <p class="eyebrow">Content draft</p>
  <h3>${escapeHtml(draft.title)}</h3>
  <p class="draft-template-pill">${escapeHtml(draft.templateLabel || draft.templateId || "Blog article")}${
    draft.placementStrategy ? ` · ${escapeHtml(draft.placementStrategy)}` : ""
  }</p>
  <p><strong>Meta:</strong> ${escapeHtml(draft.meta)}</p>
  ${renderDraftIntentSummary(draft)}
  ${auditBanner}
  <div class="draft-meta-grid">
    <p><strong>Best placement:</strong> ${escapeHtml(draft.placement || "Blog CMS article")}${
      draft.placementUrl
        ? ` — ${renderPageLink(draft.placementUrl, "Suggested page URL")}`
        : ""
    }</p>
    <p><strong>Schema:</strong> ${escapeHtml(draft.schemaSuggestion?.type || "Article")} — ${escapeHtml(draft.schemaSuggestion?.reason || "Add structured data before export.")}</p>
    <p><strong>Visual:</strong> ${escapeHtml(draft.visualPlan?.recommended || "product screenshot")} — ${escapeHtml(draft.visualPlan?.reason || "Use a relevant product or website visual.")}</p>
  </div>
  <pre class="visual-spec">${escapeHtml(visualPlanToSpec(draft.visualPlan))}</pre>
  <section class="visual-references">
    <h4>Visual references</h4>
    ${renderReferenceImages(draft.visualPlan?.referenceImages || [])}
  </section>
  <div class="draft-support-grid">
    <section>
      <h4>Website references</h4>
      ${
        draft.evidenceRefs?.length
          ? `<ul>${draft.evidenceRefs.map((ref) => renderEvidenceRef(ref)).join("")}</ul>`
          : `<p>No website references attached. Regenerate with AI to ground this draft.</p>`
      }
    </section>
    <section>
      <h4>Draft QA</h4>
      ${
        draft.qaChecks?.length
          ? `<ul>${draft.qaChecks
              .map(
                (check) =>
                  `<li class="qa-${escapeHtml(check.status)}"><strong>${escapeHtml(check.status)} · ${escapeHtml(check.label)}:</strong> ${escapeHtml(check.detail)}</li>`,
              )
              .join("")}</ul>`
          : `<p>No draft-level QA attached yet.</p>`
      }
    </section>
  </div>
  ${bodyHtml}
  ${tailHtml}
  ${ctaHtml}
`;
};

const renderDrafts = (workflow, selectedIndex = 0) => {
  const hasDrafts = workflow.drafts.length > 0;
  draftSelector.replaceChildren(
    ...workflow.drafts.map((draft, index) => {
      const option = document.createElement("option");
      option.value = String(index);
      option.textContent = draft.title;
      return option;
    }),
  );
  const draft = workflow.drafts[selectedIndex] || workflow.drafts[0];
  draftSelector.disabled = !hasDrafts;
  if (copyDraftButton) copyDraftButton.disabled = !hasDrafts;
  draftSelector.value = String(Math.max(0, selectedIndex));
  articleDraft.innerHTML = draft ? draftToHtml(draft) : `<p>No draft yet. Generate one from the content plan.</p>`;
  updateRegenerateDraftButton();
};

const renderChecklist = (workflow) => {
  const evaluated = evaluateChecklist(workflow);
  const groups = groupChecklistByCategory(evaluated);
  checklistList.replaceChildren(
    ...groups
      .filter((group) => group.items.length > 0)
      .map((group) => {
        const section = document.createElement("section");
        section.className = "checklist-group";
        section.innerHTML = `<h3 class="checklist-group-title">${escapeHtml(group.label)}</h3>`;
        const list = document.createElement("div");
        list.className = "checklist-group-items";
        list.replaceChildren(
          ...group.items.map((item) => {
            const check = document.createElement("article");
            const statusClass =
              item.status === "pass" ? "is-pass" : item.status === "warn" ? "is-warn" : "is-manual";
            const badge =
              item.kind === "auto"
                ? item.status === "pass"
                  ? "Auto pass"
                  : item.status === "warn"
                    ? "Needs attention"
                    : "Auto"
                : "Manual";
            const link = item.link && safeExternalUrl(item.link)
              ? ` <a href="${escapeHtml(safeExternalUrl(item.link))}" target="_blank" rel="noreferrer">Open guide</a>`
              : "";
            check.className = `check-item ${statusClass}`;
            check.innerHTML = `<span class="check-box">${item.status === "pass" ? "✓" : item.kind === "auto" ? "!" : "○"}</span><div><span class="check-badge">${escapeHtml(badge)}</span><p>${escapeHtml(item.item)}${link}</p></div>`;
            return check;
          }),
        );
        section.appendChild(list);
        return section;
      }),
  );
};

const renderWorkflow = (workflow, options = {}) => {
  currentWorkflow = workflow;
  if (options.syncAssumptions) applyAssumptions(workflow);
  renderStrategy(workflow);
  renderSiteCoverage(workflow);
  renderKeywords(workflow);
  renderCalendar(workflow);
  renderDrafts(workflow);
  renderChecklist(workflow);
  renderHistory();
  renderProjects();
};

const showToast = (message) => {
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.setTimeout(() => toast.classList.remove("is-visible"), 1800);
};

const exportWorkflowPackage = (workflow, provider = currentProvider) => {
  if (!workflow) {
    showToast("No workspace to export");
    return;
  }
  const bundle = createExportBundle(workflow, workflowToMarkdown(workflow), provider);
  downloadFile(
    `${workflow.inputs.domain}-content-package.json`,
    JSON.stringify(bundle, null, 2),
    "application/json",
  );
};

const importWorkflowPackage = async (file) => {
  if (!file) return;
  try {
    const record = importProjectPackageFromText(await file.text());
    projectRecords = upsertProjectRecord(projectRecords, record);
    if (!writeProjectRecords(window.localStorage, projectRecords)) {
      showToast("Local project storage is full or unavailable");
      return;
    }
    currentProvider = record.provider || null;
    enterWorkspace(record.workflow);
    selectTab("strategy");
    showToast("Project package imported");
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error));
  } finally {
    importPackageInput.value = "";
  }
};

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    selectTab(tab.dataset.tab);
  });
});

document.querySelectorAll(".rail-node").forEach((node) => {
  node.addEventListener("click", () => {
    selectTab(node.dataset.stage);
  });
});

const selectTab = (target) => {
  document.querySelectorAll(".tab").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.tab === target);
  });
  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.classList.toggle("is-active", panel.id === target);
  });
  document.querySelectorAll(".rail-node").forEach((node) => {
    node.classList.toggle("is-active", node.dataset.stage === target);
  });
};

const setGenerateBusy = (busy) => {
  generateButton.disabled = busy;
  form.querySelector(".submit-inline").disabled = busy;
  generateLabel.textContent = busy ? "Generating..." : "Analyze with AI";
  if (generateLabelInline) generateLabelInline.textContent = busy ? "..." : "Analyze";
};

planLengthInput?.addEventListener("input", syncPlanLengthLabel);
syncPlanLengthLabel();

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const url = websiteUrl.value.trim();
  if (!url) {
    showToast("Enter a website URL to analyze");
    websiteUrl.focus();
    return;
  }
  setGenerateBusy(true);
  setAppPhase("loading");
  const includeDraft = !forceAnalysisOnlySubmit && Boolean(includeDraftInput?.checked);
  startLoadingAnimation(includeDraft);
  try {
    const { workflow, fallbackReason, draftFallbackReason } = await generateAiWorkflow({ includeDraft });
    await finishLoadingAnimation();
    const savedWorkflow = persistWorkflow(workflow);
    enterWorkspace(savedWorkflow, { syncAssumptions: true });
    showToast(
      formatWorkspaceToast({
        siteContext: savedWorkflow.siteContext,
        fallbackReason,
        draftFallbackReason,
      }),
    );
  } catch (error) {
    stopLoadingAnimation();
    currentProvider = null;
    const message = formatAnalyzeError(error);
    if (loadingStage) loadingStage.textContent = "Analysis failed";
    if (loadingPercent) loadingPercent.textContent = "";
    const loadingHint = document.querySelector(".loading-hint");
    if (loadingHint) loadingHint.textContent = message;
    await new Promise((resolve) => window.setTimeout(resolve, 1600));
    enterLanding();
    showToast(formatAnalyzeToast(error));
    await refreshProviderStatus();
  } finally {
    forceAnalysisOnlySubmit = false;
    setGenerateBusy(false);
  }
});

newAnalysisButton.addEventListener("click", () => {
  enterLanding();
});

draftSelector.addEventListener("change", () => {
  const index = Number(draftSelector.value);
  articleDraft.innerHTML = draftToHtml(currentWorkflow.drafts[index]);
});

calendarList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-generate-draft]");
  if (!button || !currentWorkflow) return;
  const item = currentWorkflow.calendar[Number(button.dataset.generateDraft)];
  if (item) generateDraftForCalendarItem(item, button);
});

siteCoverage.addEventListener("click", (event) => {
  const button = event.target.closest("[data-reanalyze-site]");
  if (!button) return;
  forceAnalysisOnlySubmit = true;
  form.requestSubmit();
});

copyDraftButton?.addEventListener("click", async () => {
  if (!currentWorkflow?.drafts?.length) return;
  const index = Number(draftSelector.value);
  await navigator.clipboard.writeText(draftToMarkdown(currentWorkflow.drafts[index]));
  showToast("Draft copied");
});

regenerateDraftButton?.addEventListener("click", async () => {
  if (!currentWorkflow?.drafts?.length) return;
  const index = Number(draftSelector.value);
  const draft = currentWorkflow.drafts[index];
  if (!draft) return;

  const calendarItem = findCalendarItemForDraft(draft);
  if (!calendarItem) {
    showToast("Could not match this draft to a calendar entry.");
    return;
  }
  if (!window.confirm("Regenerating will replace the current draft. Continue?")) return;

  regenerateDraftButton.disabled = true;
  try {
    await requestDraftFromApi(calendarItem, { replaceIndex: index, progressButton: regenerateDraftButton });
  } catch (error) {
    showToast(formatDraftError(error));
  } finally {
    regenerateDraftButton.textContent = "Regenerate";
    updateRegenerateDraftButton();
  }
});

document.querySelector("#export-markdown").addEventListener("click", () => {
  if (!currentWorkflow) return;
  downloadFile(
    `${currentWorkflow.inputs.domain}-content-workspace.md`,
    workflowToMarkdown(currentWorkflow),
    "text/markdown",
  );
});

document.querySelector("#export-json").addEventListener("click", () => {
  if (!currentWorkflow) return;
  downloadFile(
    `${currentWorkflow.inputs.domain}-content-workspace.json`,
    JSON.stringify(currentWorkflow, null, 2),
    "application/json",
  );
});

exportPackageButton.addEventListener("click", () => {
  exportWorkflowPackage(currentWorkflow);
});

importPackageButton.addEventListener("click", () => {
  importPackageInput.click();
});

importPackageInput.addEventListener("change", () => {
  importWorkflowPackage(importPackageInput.files?.[0]);
});

projectList.addEventListener("click", (event) => {
  const loadButton = event.target.closest("[data-load-project]");
  const exportButton = event.target.closest("[data-export-project]");
  const removeButton = event.target.closest("[data-remove-project]");
  const id = loadButton?.dataset.loadProject || exportButton?.dataset.exportProject || removeButton?.dataset.removeProject;
  if (!id) return;

  const record = projectRecords.find((item) => item.id === id);
  if (loadButton && record) {
    currentProvider = record.provider || null;
    websiteUrl.value = record.workflow.inputs?.url || record.url || websiteUrl.value;
    enterWorkspace(record.workflow);
    selectTab("strategy");
    showToast("Project loaded");
  }

  if (exportButton && record) {
    exportWorkflowPackage(record.workflow, record.provider);
    showToast("Project package exported");
  }

  if (removeButton) {
    projectRecords = removeProjectRecord(projectRecords, id);
    if (!writeProjectRecords(window.localStorage, projectRecords)) {
      showToast("Local project storage is unavailable");
      return;
    }
    renderProjects();
    showToast("Project removed");
  }
});

setAppPhase("landing");
refreshProviderStatus();
initAppMeta();

window.addEventListener("pageshow", (event) => {
  if (event.persisted && appPhase === "loading") {
    enterLanding();
    setGenerateBusy(false);
  }
});
