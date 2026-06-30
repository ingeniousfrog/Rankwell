export const GENERATE_PROGRESS_STAGES = [
  { id: "discover", label: "Discovering site structure", progress: 8 },
  { id: "robots-sitemap", label: "Reading robots.txt & sitemap", progress: 18 },
  { id: "crawl", label: "Crawling pages for context", progress: 38 },
  { id: "ai-workflow", label: "Composing planning notes", progress: 58 },
  { id: "process-strategy", label: "Mapping search themes", progress: 74 },
  { id: "process-calendar", label: "Building content plan", progress: 86 },
  { id: "draft", label: "Generating starter draft", progress: 94 },
  { id: "finalize", label: "Finalizing workspace", progress: 100 },
];

export const DRAFT_PROGRESS_LABELS = {
  plan: "Planning starter draft",
  compose: "Gathering draft context",
  write: "Writing starter draft",
  audit: "Reviewing starter draft",
  revise: "Revising starter draft",
};

const stageById = new Map(GENERATE_PROGRESS_STAGES.map((stage, index) => [stage.id, { ...stage, index }]));

export const getVisibleProgressStages = (includeDraft = false) =>
  includeDraft ? GENERATE_PROGRESS_STAGES : GENERATE_PROGRESS_STAGES.filter((stage) => stage.id !== "draft");

export const getStageIndex = (stageId) => stageById.get(stageId)?.index ?? -1;

export const crawlProgressValue = (pagesFetched, maxPages) => {
  const floor = stageById.get("robots-sitemap")?.progress ?? 18;
  const ceiling = stageById.get("crawl")?.progress ?? 38;
  const ratio = Math.min(1, pagesFetched / Math.max(maxPages, 1));
  return floor + (ceiling - floor) * ratio;
};

export const createProgressReporter = (onProgress, { includeDraft = false } = {}) => {
  const report = (stageId, extras = {}) => {
    if (!includeDraft && stageId === "draft") return null;
    const stage = stageById.get(stageId);
    if (!stage || typeof onProgress !== "function") return null;

    const payload = {
      type: "progress",
      stageId,
      stageIndex: stage.index,
      label: extras.label || stage.label,
      progress:
        typeof extras.progress === "number"
          ? Math.max(0, Math.min(100, extras.progress))
          : stage.progress,
      detail: extras.detail || "",
    };
    onProgress(payload);
    return payload;
  };

  return report;
};
