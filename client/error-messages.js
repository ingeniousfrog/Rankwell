export const ANALYZE_TIMEOUT_MS = 420_000;
export const DRAFT_TIMEOUT_MS = 300_000;

export async function fetchWithTimeout(url, options = {}, timeoutMs = ANALYZE_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") {
      const timeoutError = new Error("Analysis request timed out");
      timeoutError.name = "AbortError";
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function classifyClientError(error) {
  const message = error instanceof Error ? error.message : String(error);
  const cause = error && typeof error === "object" ? error.cause : null;
  const causeCode = typeof cause?.code === "string" ? cause.code : "";
  const causeMessage =
    cause instanceof Error ? cause.message : typeof cause?.message === "string" ? cause.message : "";

  if (error?.name === "AbortError" || cause?.name === "AbortError" || /timed out/i.test(message)) {
    return {
      kind: "timeout",
      short: "Request timed out",
      message: "The request took too long and was cancelled.",
      hint: "Try a smaller plan length, disable the starter draft, or retry when Codex is less busy.",
    };
  }

  if (
    message === "Failed to fetch" ||
    message === "Load failed" ||
    (error instanceof TypeError && /fetch|load failed/i.test(message)) ||
    causeCode === "ECONNREFUSED" ||
    /ECONNREFUSED|ENOTFOUND|network/i.test(causeMessage)
  ) {
    return {
      kind: "server-unreachable",
      short: "Can't reach local server",
      message: "Rankwell could not connect to the local API.",
      hint: "Run npm run start and open http://127.0.0.1:5279. Do not open index.html directly.",
    };
  }

  return {
    kind: "api-error",
    short: "Analysis failed",
    message,
    hint: "",
  };
}

export function formatAnalyzeError(error) {
  const classified = classifyClientError(error);
  return classified.hint ? `${classified.message} ${classified.hint}` : classified.message;
}

export function formatAnalyzeToast(error) {
  const classified = classifyClientError(error);
  if (classified.kind === "server-unreachable" || classified.kind === "timeout") {
    return `${classified.short}. ${classified.hint}`;
  }
  return `Could not analyze site: ${classified.message}`;
}

export function formatDraftError(error) {
  const classified = classifyClientError(error);
  if (classified.kind === "server-unreachable") {
    return `${classified.short}. ${classified.hint}`;
  }
  if (classified.kind === "timeout") {
    return `Draft generation timed out. ${classified.hint}`;
  }
  return classified.message || "Draft generation failed.";
}

const CRAWL_FAILURE_COPY = {
  "robots-blocked": {
    title: "Crawl blocked by robots.txt",
    message: "robots.txt disallows crawling this site for Rankwell's user agent.",
    hint: "The workspace was built without site evidence. Try a site you control or one that allows generic crawlers.",
  },
  "fetch-failed": {
    title: "Site fetch failed",
    message: "Rankwell could not download pages from this URL.",
    hint: "Check the URL, your network, and whether the site blocks automated requests.",
  },
  "no-pages": {
    title: "No crawlable pages found",
    message: "No HTML pages were fetched from this site.",
    hint: "Confirm the URL is correct and the site returns public HTML over HTTPS.",
  },
};

export function describeSiteCrawlIssue(siteContext) {
  if (!siteContext || siteContext.ok !== false) return null;

  const kind = siteContext.discovery?.failureKind || "no-pages";
  const copy = CRAWL_FAILURE_COPY[kind] || CRAWL_FAILURE_COPY["no-pages"];

  return {
    kind,
    title: copy.title,
    message: siteContext.error || copy.message,
    hint: copy.hint,
  };
}

export function formatWorkspaceToast({ siteContext, fallbackReason, draftFallbackReason }) {
  if (draftFallbackReason) return draftFallbackReason;
  if (fallbackReason) return fallbackReason;

  const crawlIssue = describeSiteCrawlIssue(siteContext);
  if (crawlIssue) {
    return `Workspace ready with limited data: ${crawlIssue.title}. ${crawlIssue.hint}`;
  }

  return "Workspace generated";
}
