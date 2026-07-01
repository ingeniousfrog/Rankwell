import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { auditCalendar } from "./lib/content-audit.js";
import { buildWorkflowPrompt } from "./lib/ai-prompts.js";
import { DRAFT_PROGRESS_LABELS, createProgressReporter } from "./lib/generate-progress.js";
import { runDraftPipeline } from "./lib/draft-pipeline.js";
import { auditDraftFull } from "./lib/draft-quality-audit.js";
import { normalizePlanLength, PLAN_LENGTH_MIN } from "./lib/plan-length.js";
import { isAllowedLocalOrigin, isLikelyPublicHttpUrl } from "./lib/request-security.js";
import { buildRefreshCandidates } from "./lib/refresh-candidates.js";
import { createSiteContext } from "./lib/site-context.js";
import { pageWasCrawled } from "./lib/site-grounding.js";
import { createFallbackWorkflow, buildDraft } from "./client/fallback-workflow.js";
import { readResponsesSseStream } from "./lib/codex-stream.js";

const moduleDir = (() => {
  const metaUrl = import.meta.url;
  if (typeof metaUrl === "string" && metaUrl.length > 0) {
    return path.dirname(fileURLToPath(metaUrl));
  }
  if (process.argv[1]) return path.dirname(process.argv[1]);
  return process.cwd();
})();
const STATIC_ROOT = process.env.STATIC_ROOT?.trim() || moduleDir;
const PORT = Number(process.env.PORT || 5279);
const CODEX_BACKEND_BASE_URL = "https://chatgpt.com/backend-api/codex";
const REFRESH_URL = "https://auth.openai.com/oauth/token";
const CODEX_OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const REFRESH_SKEW_SECONDS = 30;
const MAX_BODY_BYTES = 32_000;
const DEFAULT_AI_MODEL = "gpt-5.5";
const ALLOW_PRIVATE_TARGETS = process.env.ALLOW_PRIVATE_TARGETS === "1";
const SITE_CONTEXT_CACHE_TTL_MS = 30 * 60 * 1000;
const siteContextCache = new Map();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

class CodexAuthError extends Error {
  constructor(message) {
    super(message);
    this.name = "CodexAuthError";
  }
}

const sendJson = (res, status, body) => {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
};

const sendNdjsonLine = (res, payload) => {
  res.write(`${JSON.stringify(payload)}\n`);
  if (typeof res.flush === "function") {
    res.flush();
  }
};

const wantsNdjsonStream = (req) => String(req.headers.accept || "").includes("application/x-ndjson");

const getCodexHome = () => {
  const defaultHome = path.join(os.homedir(), ".codex");
  const fromEnv = process.env.CODEX_HOME?.trim();
  return fromEnv || defaultHome;
};
const getCodexAuthPath = () => path.join(getCodexHome(), "auth.json");

const readCodexDefaultModel = () => {
  const configPath = path.join(getCodexHome(), "config.toml");
  if (!fs.existsSync(configPath)) return undefined;
  try {
    const text = fs.readFileSync(configPath, "utf8");
    return text.match(/^model\s*=\s*"([^"]+)"/m)?.[1];
  } catch {
    return undefined;
  }
};

const readCodexAuthStatus = () => {
  const codexHome = getCodexHome();
  const authPath = getCodexAuthPath();
  const defaultModel = readCodexDefaultModel();

  if (!fs.existsSync(authPath)) {
    return {
      configured: false,
      codexHome,
      authPath,
      defaultModel,
      message: `No auth file found at ${authPath}. Run codex login on this machine and try again.`,
    };
  }

  try {
    const data = JSON.parse(fs.readFileSync(authPath, "utf8"));
    const authMode = data.auth_mode;
    if (authMode !== "chatgpt") {
      return {
        configured: false,
        authMode,
        codexHome,
        authPath,
        defaultModel,
        message: `auth.json has auth_mode "${authMode ?? "unknown"}". Only ChatGPT login mode ("chatgpt") is supported.`,
      };
    }
    if (!data.tokens?.access_token) {
      return {
        configured: false,
        authMode,
        codexHome,
        authPath,
        defaultModel,
        message: "auth.json is missing access_token. Run codex login to re-authenticate.",
      };
    }
    return {
      configured: true,
      authMode,
      codexHome,
      authPath,
      defaultModel,
      activeModel: getActiveModel(defaultModel),
      message: "Local Codex CLI login detected. AI generation can reuse Codex OAuth on this machine.",
    };
  } catch (error) {
    return {
      configured: false,
      codexHome,
      authPath,
      defaultModel,
      message: `Unable to read auth.json: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
};

const getActiveModel = (codexDefaultModel = readCodexDefaultModel()) => {
  if (process.env.AI_MODEL?.trim()) return process.env.AI_MODEL.trim();
  if (codexDefaultModel) return codexDefaultModel;
  return DEFAULT_AI_MODEL;
};

const jwtExp = (token) => {
  try {
    const payloadB64 = token.split(".")[1];
    if (!payloadB64) return null;
    const padded = payloadB64 + "=".repeat((4 - (payloadB64.length % 4)) % 4);
    const payload = JSON.parse(Buffer.from(padded, "base64url").toString("utf8"));
    return typeof payload.exp === "number" ? payload.exp : null;
  } catch {
    return null;
  }
};

const fetchWithRetry = async (url, options, { retries = 1, timeoutMs = 120_000 } = {}) => {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } catch (error) {
      lastError = error;
      if (attempt === retries) break;
    } finally {
      clearTimeout(timeout);
    }
    await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)));
  }
  throw lastError;
};

const refreshCodexTokens = async (refreshToken) => {
  let response;
  try {
    response = await fetchWithRetry(
      REFRESH_URL,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: CODEX_OAUTH_CLIENT_ID,
          grant_type: "refresh_token",
          refresh_token: refreshToken,
        }),
      },
      { timeoutMs: 30_000, retries: 2 },
    );
  } catch (error) {
    throw new CodexAuthError(
      `Network failure while refreshing Codex auth token: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const bodyText = await response.text();
  if (!response.ok) {
    let code;
    try {
      code = JSON.parse(bodyText).error;
    } catch {
      code = undefined;
    }
    if (["refresh_token_expired", "refresh_token_reused", "refresh_token_invalidated"].includes(code)) {
      throw new CodexAuthError(`Refresh token is no longer valid (${code}). Run codex login to re-authenticate.`);
    }
    throw new CodexAuthError(`Failed to refresh Codex token: HTTP ${response.status}`);
  }
  return JSON.parse(bodyText);
};

const writeAuthFile = (authPath, data) => {
  const tmp = `${authPath}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(tmp, authPath);
  fs.chmodSync(authPath, 0o600);
};

const borrowCodexCredentials = async () => {
  const status = readCodexAuthStatus();
  if (!status.configured) throw new CodexAuthError(status.message);

  const authPath = getCodexAuthPath();
  const data = JSON.parse(fs.readFileSync(authPath, "utf8"));
  if (data.auth_mode !== "chatgpt") {
    throw new CodexAuthError(`Unsupported auth_mode: ${data.auth_mode ?? "unknown"}`);
  }

  const tokens = data.tokens;
  let accessToken = tokens.access_token;
  const accountId = tokens.account_id;
  const exp = jwtExp(accessToken);

  if (exp !== null && Date.now() / 1000 < exp - REFRESH_SKEW_SECONDS) {
    return { accessToken, accountId };
  }

  if (!tokens.refresh_token) {
    throw new CodexAuthError("access_token expired and refresh_token is missing. Run codex login.");
  }

  const newTokens = await refreshCodexTokens(tokens.refresh_token);
  if (newTokens.access_token) tokens.access_token = newTokens.access_token;
  if (newTokens.id_token) tokens.id_token = newTokens.id_token;
  if (newTokens.refresh_token) tokens.refresh_token = newTokens.refresh_token;
  data.tokens = tokens;
  data.last_refresh = new Date().toISOString();
  writeAuthFile(authPath, data);

  accessToken = tokens.access_token;
  return { accessToken, accountId };
};

const readRequestBody = (req) =>
  new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
        reject(new Error("Request body is too large."));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });

const cleanString = (value, fallback = "") =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, 500) : fallback;

const formatCodexError = (status, detail) => {
  let parsed = null;
  try {
    parsed = JSON.parse(detail);
  } catch {
    parsed = null;
  }
  const err = parsed?.error;
  if (status === 429 || err?.type === "usage_limit_reached") {
    const minutes = err?.resets_in_seconds ? Math.max(1, Math.ceil(err.resets_in_seconds / 60)) : null;
    return minutes
      ? `Codex usage limit reached. Resets in about ${minutes} minutes. Showing a local template instead of AI output.`
      : "Codex usage limit reached. Showing a local template instead of AI output.";
  }
  if (err?.message) return `Codex error: ${err.message}`;
  return `Codex OAuth provider failed: HTTP ${status}${detail ? ` - ${detail.slice(0, 180)}` : ""}`;
};

const resolveSiteContext = async ({ url, providedSiteContext = null, onProgress }) => {
  if (providedSiteContext && typeof providedSiteContext === "object") {
    onProgress?.({
      stageId: "crawl",
      progress: 38,
      detail: "Using provided site context",
    });
    return providedSiteContext;
  }

  const key = String(url || "").trim().toLowerCase();
  const cached = siteContextCache.get(key);
  if (cached && Date.now() - cached.cachedAt < SITE_CONTEXT_CACHE_TTL_MS) {
    onProgress?.({
      stageId: "crawl",
      progress: 38,
      detail: "Using cached site context",
    });
    return cached.siteContext;
  }

  const siteContext = await createSiteContext({
    url,
    fetchImpl: fetch,
    onProgress: (payload) => onProgress?.(payload),
  });
  if (key) {
    siteContextCache.set(key, { siteContext, cachedAt: Date.now() });
  }
  return siteContext;
};

const validateGenerateInput = (raw) => {
  const body = raw && typeof raw === "object" ? raw : {};
  const url = cleanString(body.url, "https://example.com");
  try {
    new URL(url);
  } catch {
    throw new Error("Website URL must be a valid absolute URL.");
  }
  if (!isLikelyPublicHttpUrl(url, { allowPrivateTargets: ALLOW_PRIVATE_TARGETS })) {
    throw new Error("Website URL must be a public http(s) URL. Set ALLOW_PRIVATE_TARGETS=1 to analyze local or private-network sites.");
  }
  return {
    url,
    domain: cleanString(body.domain, new URL(url).hostname.replace(/^www\./, "")),
    category: cleanString(body.category),
    audience: cleanString(body.audience),
    goal: cleanString(body.goal),
    voice: cleanString(body.voice),
    planLength: normalizePlanLength(body.planLength),
    includeDraft: body.includeDraft === true,
  };
};

const parseModelJson = (text) => {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Model did not return JSON.");
    return JSON.parse(match[0]);
  }
};

const estimateUsage = (text) => ({
  estimated: true,
  input_tokens: null,
  output_tokens: Math.ceil(text.length / 4),
  total_tokens: Math.ceil(text.length / 4),
});

const normalizeUsage = (usage, text) => {
  if (!usage || typeof usage !== "object") return estimateUsage(text);
  return {
    estimated: false,
    input_tokens: usage.input_tokens ?? usage.prompt_tokens ?? null,
    output_tokens: usage.output_tokens ?? usage.completion_tokens ?? null,
    total_tokens: usage.total_tokens ?? null,
  };
};

const assertWorkflowShape = (workflow, options = {}) => {
  const requireDraft = options.requireDraft === true;
  if (!workflow || typeof workflow !== "object") throw new Error("Workflow is not an object.");
  if (!workflow.strategy || typeof workflow.strategy !== "object") throw new Error("Workflow is missing strategy.");
  if (!Array.isArray(workflow.keywords) || workflow.keywords.length < 3) {
    throw new Error("Workflow is missing keywords.");
  }
  if (!Array.isArray(workflow.calendar) || workflow.calendar.length < PLAN_LENGTH_MIN) {
    throw new Error("Workflow is missing calendar items.");
  }
  if (!Array.isArray(workflow.drafts) || (requireDraft && workflow.drafts.length < 1)) {
    throw new Error("Workflow is missing drafts.");
  }
  if (!Array.isArray(workflow.checklist) || workflow.checklist.length < 3) {
    throw new Error("Workflow is missing checklist.");
  }
};

const assertDraftShape = (draft) => {
  if (!draft || typeof draft !== "object") throw new Error("Draft is not an object.");
  if (!draft.title || !draft.meta) throw new Error("Draft is missing required fields.");
  const hasSections = Array.isArray(draft.sections) && draft.sections.length > 0;
  const hasBlocks = Array.isArray(draft.blocks) && draft.blocks.length > 0;
  if (!hasSections && !hasBlocks) {
    throw new Error("Draft is missing sections or template blocks.");
  }
};

const mergeDraftQaChecks = (draft, calendarItem, siteContext, input, draftIntent = null) => {
  const audit = auditDraftFull(draft, calendarItem, siteContext, input, draftIntent);
  const existingLabels = new Set((draft.qaChecks || []).map((check) => check.label));
  draft.qaChecks = [
    ...(Array.isArray(draft.qaChecks) ? draft.qaChecks : []),
    ...audit.checks.filter((check) => !existingLabels.has(check.label)),
  ];
  draft.templateAudit = {
    hasFailures: audit.hasFailures,
    suggestedPlacement: audit.suggestedPlacement,
  };
  return draft;
};

const callCodexModel = async (prompt, { timeoutMs = 180_000 } = {}) => {
  const { accessToken, accountId } = await borrowCodexCredentials();
  const model = getActiveModel();
  const response = await fetchWithRetry(
    `${CODEX_BACKEND_BASE_URL}/responses`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        ...(accountId ? { "ChatGPT-Account-ID": accountId } : {}),
      },
      body: JSON.stringify({
        model,
        input: [{ role: "user", content: prompt.message }],
        instructions: prompt.instructions,
        store: false,
        stream: true,
      }),
    },
    { timeoutMs, retries: 1 },
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(formatCodexError(response.status, detail));
  }
  if (!response.body) throw new Error("Codex OAuth provider returned empty body.");

  const { text, usage } = await readResponsesSseStream(response.body, { idleTimeoutMs: timeoutMs });
  if (!text.trim()) throw new Error("Codex OAuth provider returned empty response.");
  return {
    model,
    parsed: parseModelJson(text),
    usage: normalizeUsage(usage, text),
  };
};

const generateDraftPipeline = async ({ input, calendarItem, existingTitles, siteContext, onStage }) => {
  const modelResult = await runDraftPipeline({
    input,
    calendarItem,
    existingTitles,
    siteContext,
    onStage,
    callModel: async (prompt, options) => callCodexModel(prompt, options),
  });
  assertDraftShape(modelResult.draft);
  return {
    provider: "codex-oauth",
    model: getActiveModel(),
    draft: modelResult.draft,
    draftRuntime: modelResult.draftRuntime,
    usage: modelResult.usage,
  };
};

const repairInitialDraft = (workflow, input, siteContext) => {
  const calendarItem = Array.isArray(workflow.calendar) ? workflow.calendar[0] : null;
  if (!calendarItem) {
    throw new Error("Workflow is missing calendar items.");
  }
  const mergedInput = {
    ...input,
    ...(workflow.inputs && typeof workflow.inputs === "object" ? workflow.inputs : {}),
  };
  const draft = buildDraft(calendarItem, mergedInput, siteContext);
  draft.qaChecks = [
    ...(Array.isArray(draft.qaChecks) ? draft.qaChecks : []),
    {
      label: "Draft repair",
      status: "warn",
      detail:
        "The AI workflow succeeded but the day-1 draft was missing or invalid, so a local template draft was inserted. Use Regenerate to try AI again.",
    },
  ];
  return draft;
};

const ensureInitialDraft = (workflow, input, siteContext) => {
  const firstDraft = Array.isArray(workflow.drafts) ? workflow.drafts[0] : null;
  try {
    if (!firstDraft) throw new Error("Initial draft is missing.");
    assertDraftShape(firstDraft);
    return null;
  } catch {
    workflow.drafts = [repairInitialDraft(workflow, input, siteContext)];
    return "Initial AI draft was missing or invalid, so a local day-1 template was inserted. Use Regenerate to try AI again.";
  }
};

const sanitizeRefreshCandidates = (workflow, siteContext) => {
  const strategy = workflow.strategy && typeof workflow.strategy === "object" ? workflow.strategy : {};
  const aiCandidates = Array.isArray(strategy.refreshCandidates) ? strategy.refreshCandidates : [];
  const validAi = aiCandidates.filter((item) => item?.url && pageWasCrawled(item.url, siteContext));
  const deterministic = buildRefreshCandidates(siteContext);
  const seen = new Set();
  strategy.refreshCandidates = [...validAi, ...deterministic]
    .filter((item) => {
      if (!item?.url || seen.has(item.url)) return false;
      seen.add(item.url);
      return pageWasCrawled(item.url, siteContext);
    })
    .slice(0, 12);
  workflow.strategy = strategy;
};

const generateWorkflowWithAi = async (input, siteContext, report) => {
  report?.("ai-workflow");
  const { accessToken, accountId } = await borrowCodexCredentials();
  const model = getActiveModel();
  const prompt = buildWorkflowPrompt(input, siteContext);
  const response = await fetchWithRetry(
    `${CODEX_BACKEND_BASE_URL}/responses`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        ...(accountId ? { "ChatGPT-Account-ID": accountId } : {}),
      },
      body: JSON.stringify({
        model,
        input: [{ role: "user", content: prompt.message }],
        instructions: prompt.instructions,
        store: false,
        stream: true,
      }),
    },
    { timeoutMs: 180_000, retries: 1 },
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(formatCodexError(response.status, detail));
  }
  if (!response.body) throw new Error("Codex OAuth provider returned empty body.");

  const { text, usage } = await readResponsesSseStream(response.body, { idleTimeoutMs: 90_000 });
  if (!text.trim()) throw new Error("Codex OAuth provider returned empty response.");
  const workflow = parseModelJson(text);
  report?.("process-strategy");
  workflow.inputs = { ...input, ...(workflow.inputs && typeof workflow.inputs === "object" ? workflow.inputs : {}) };
  workflow.siteContext = siteContext;
  sanitizeRefreshCandidates(workflow, siteContext);
  report?.("process-calendar");
  const calendarAudit = auditCalendar(workflow.calendar || [], workflow.inputs, siteContext);
  workflow.calendar = calendarAudit.items;
  workflow.calendarAudit = calendarAudit.summary;
  let draftFallbackReason = null;
  if (input.includeDraft && workflow.calendar?.[0]) {
    draftFallbackReason = ensureInitialDraft(workflow, input, siteContext);
    try {
      const pipelineResult = await generateDraftPipeline({
        input: workflow.inputs || input,
        calendarItem: workflow.calendar[0],
        existingTitles: (workflow.drafts || []).map((draft) => draft.title).filter(Boolean),
        siteContext,
        onStage: (stage) => {
          report?.("draft", {
            label: DRAFT_PROGRESS_LABELS[stage] || "Generating starter draft",
          });
        },
      });
      workflow.drafts = [pipelineResult.draft];
      workflow.day1DraftRuntime = pipelineResult.draftRuntime;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      draftFallbackReason =
        draftFallbackReason ||
        `Starter draft AI pipeline failed: ${message}`;
      if (workflow.drafts?.[0]) {
        mergeDraftQaChecks(
          workflow.drafts[0],
          workflow.calendar[0],
          siteContext,
          input,
          workflow.drafts[0].draftRuntime?.intent,
        );
      }
    }
  } else {
    workflow.drafts = [];
  }
  report?.("finalize");
  assertWorkflowShape(workflow, { requireDraft: input.includeDraft });
  return {
    provider: "codex-oauth",
    model,
    workflow,
    usage: normalizeUsage(usage, text),
    draftFallbackReason,
  };
};

const generateWorkflow = async (input, { onProgress } = {}) => {
  const report = createProgressReporter(onProgress, { includeDraft: input.includeDraft });
  const relayCrawlProgress = (payload) => {
    if (!payload?.stageId) return;
    report(payload.stageId, {
      progress: payload.progress,
      detail: payload.detail,
    });
  };

  report("discover");
  const siteContext = await resolveSiteContext({ url: input.url, onProgress: relayCrawlProgress });
  try {
    return await generateWorkflowWithAi(input, siteContext, report);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    report("process-strategy", { detail: "Falling back to local rules" });
    report("process-calendar");
    report("finalize", { detail: message });
    return {
      provider: "local-rules",
      model: "rules",
      workflow: createFallbackWorkflow(input, siteContext),
      usage: null,
      fallbackReason: message,
    };
  }
};

const generateDraftWithAi = async ({ input, calendarItem, existingTitles, siteContext, onStage }) =>
  generateDraftPipeline({ input, calendarItem, existingTitles, siteContext, onStage });

const generateDraft = async ({ input, calendarItem, existingTitles, siteContext: providedSiteContext, onStage }) => {
  const siteContext = await resolveSiteContext({ url: input.url, providedSiteContext });
  try {
    const result = await generateDraftWithAi({ input, calendarItem, existingTitles, siteContext, onStage });
    return {
      ...result,
      draftRuntime: result.draftRuntime || result.draft?.draftRuntime || null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const draft = buildDraft(calendarItem, input, siteContext);
    draft.qaChecks = [
      ...(Array.isArray(draft.qaChecks) ? draft.qaChecks : []),
      {
        label: "AI fallback",
        status: "warn",
        detail: message,
      },
    ];
    return {
      provider: "local-rules",
      model: "rules",
      draft,
      draftRuntime: draft.draftRuntime || null,
      usage: null,
      fallbackReason: message,
    };
  }
};

const validateDraftInput = (raw) => {
  const body = raw && typeof raw === "object" ? raw : {};
  const input = validateGenerateInput(body.input || {});
  const calendarItem = body.calendarItem && typeof body.calendarItem === "object" ? body.calendarItem : null;
  if (!calendarItem?.title || !calendarItem?.keyword) {
    throw new Error("calendarItem with title and keyword is required.");
  }
  const existingTitles = Array.isArray(body.existingTitles)
    ? body.existingTitles.filter((title) => typeof title === "string").slice(0, 30)
    : [];
  const siteContext =
    body.siteContext && typeof body.siteContext === "object" ? body.siteContext : null;
  return { input, calendarItem, existingTitles, siteContext };
};

const serveStatic = (req, res) => {
  const rawPath = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
  const relativePath = rawPath === "/" ? "index.html" : rawPath.replace(/^\/+/, "");
  const filePath = path.normalize(path.join(STATIC_ROOT, relativePath));

  if (!filePath.startsWith(STATIC_ROOT) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }

  const ext = path.extname(filePath);
  res.writeHead(200, {
    "Content-Type": mimeTypes[ext] || "application/octet-stream",
    "Cache-Control": "no-store",
  });
  fs.createReadStream(filePath).pipe(res);
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/") && !isAllowedLocalOrigin(req.headers, PORT)) {
      sendJson(res, 403, { error: "API requests are only accepted from this local app origin." });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/provider/status") {
      sendJson(res, 200, readCodexAuthStatus());
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/generate") {
      const rawBody = await readRequestBody(req);
      const input = validateGenerateInput(JSON.parse(rawBody || "{}"));
      if (wantsNdjsonStream(req)) {
        res.writeHead(200, {
          "Content-Type": "application/x-ndjson; charset=utf-8",
          "Cache-Control": "no-cache, no-store, must-revalidate",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        });
        sendNdjsonLine(res, {
          type: "progress",
          stageId: "discover",
          stageIndex: 0,
          label: "Discovering site structure",
          progress: 4,
          detail: "Starting analysis",
        });
        try {
          const result = await generateWorkflow(input, {
            onProgress: (payload) => sendNdjsonLine(res, payload),
          });
          sendNdjsonLine(res, { type: "complete", ...result });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          sendNdjsonLine(res, { type: "error", error: message });
        }
        res.end();
        return;
      }
      const result = await generateWorkflow(input);
      sendJson(res, 200, result);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/draft") {
      const rawBody = await readRequestBody(req);
      const input = validateDraftInput(JSON.parse(rawBody || "{}"));
      const result = await generateDraft(input);
      sendJson(res, 200, result);
      return;
    }

    if (req.method === "GET" || req.method === "HEAD") {
      serveStatic(req, res);
      return;
    }

    sendJson(res, 405, { error: "Method not allowed." });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendJson(res, 400, { error: message });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Rankwell running at http://127.0.0.1:${PORT}/`);
});
