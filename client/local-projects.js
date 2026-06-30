const STORAGE_KEY = "rankwell.localProjects.v1";
const MAX_PROJECTS = 20;
const MAX_IMPORT_PACKAGE_CHARS = 5_000_000;

const slugify = (value) =>
  String(value || "project")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "project";

const normalizeDate = (now) => (typeof now === "string" ? now : now.toISOString());

const createProjectId = (domain, savedAt) => `${slugify(domain)}-${Date.parse(savedAt)}`;

export const formatSavedAt = (value) => (Number.isNaN(Date.parse(value)) ? "unknown time" : new Date(value).toLocaleString());

export const createProjectRecord = (workflow, provider = null, now = new Date()) => {
  const updatedAt = normalizeDate(now);
  const savedAt = workflow.localProject?.savedAt || updatedAt;
  const id = workflow.localProject?.id || createProjectId(workflow.inputs?.domain, savedAt);
  const title = `${workflow.inputs?.domain || "Website"} planning workspace`;
  const localProject = {
    ...(workflow.localProject || {}),
    id,
    title,
    url: workflow.inputs?.url || "",
    domain: workflow.inputs?.domain || "",
    pageCount: workflow.siteContext?.summary?.pageCount || workflow.siteContext?.pages?.length || 0,
    savedAt,
    updatedAt,
  };

  return {
    id,
    title,
    url: localProject.url,
    domain: localProject.domain,
    pageCount: localProject.pageCount,
    savedAt,
    updatedAt,
    provider,
    workflow: {
      ...workflow,
      localProject,
    },
  };
};

export const upsertProjectRecord = (records, record, maxProjects = MAX_PROJECTS) =>
  [record, ...records.filter((item) => item.id !== record.id)]
    .sort((a, b) => Date.parse(b.updatedAt || b.savedAt) - Date.parse(a.updatedAt || a.savedAt))
    .slice(0, maxProjects);

export const removeProjectRecord = (records, id) => records.filter((record) => record.id !== id);

export const readProjectRecords = (storage = globalThis.localStorage) => {
  if (!storage) return [];
  try {
    const stored = storage.getItem(STORAGE_KEY) || "[]";
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed.filter((record) => record?.id && record?.workflow) : [];
  } catch {
    return [];
  }
};

export const writeProjectRecords = (storage = globalThis.localStorage, records) => {
  if (!storage) return false;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(records.slice(0, MAX_PROJECTS)));
    return true;
  } catch {
    return false;
  }
};

export const createExportBundle = (workflow, markdown, provider = null, now = new Date()) => ({
  schemaVersion: 1,
  exportedAt: normalizeDate(now),
  provider,
  workflow,
  markdown,
  sitePages: workflow.siteContext?.pages || [],
  drafts: workflow.drafts || [],
});

const parseProjectPackage = (text) => {
  if (typeof text !== "string") {
    throw new Error("Project package must be valid JSON text.");
  }
  if (text.length > MAX_IMPORT_PACKAGE_CHARS) {
    throw new Error("Project package is too large to import.");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Project package must be valid JSON.");
  }
};

const assertImportedWorkflow = (workflow) => {
  if (!workflow || typeof workflow !== "object") {
    throw new Error("Project package is missing workflow.");
  }
  if (!workflow.inputs || typeof workflow.inputs !== "object") {
    throw new Error("Project package workflow is missing inputs.");
  }
  if (!workflow.inputs.url || !workflow.inputs.domain) {
    throw new Error("Project package workflow must include inputs.url and inputs.domain.");
  }
  if (!workflow.strategy || typeof workflow.strategy !== "object") {
    throw new Error("Project package workflow is missing strategy.");
  }
  if (!Array.isArray(workflow.keywords) || !Array.isArray(workflow.calendar) || !Array.isArray(workflow.drafts)) {
    throw new Error("Project package workflow is missing content arrays.");
  }
  if (!Array.isArray(workflow.checklist)) {
    throw new Error("Project package workflow is missing checklist.");
  }
  if (workflow.drafts.some((draft) => !draft || typeof draft !== "object" || !Array.isArray(draft.sections))) {
    throw new Error("Project package workflow has invalid drafts.");
  }
};

export const importProjectPackageFromText = (text, now = new Date()) => {
  const parsed = parseProjectPackage(text);
  const workflow = parsed?.workflow && typeof parsed.workflow === "object" ? parsed.workflow : parsed;
  assertImportedWorkflow(workflow);
  const provider = parsed?.provider && typeof parsed.provider === "object" ? parsed.provider : null;
  return createProjectRecord(workflow, provider, now);
};
