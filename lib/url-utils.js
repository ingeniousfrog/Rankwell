const SKIPPED_EXTENSIONS = new Set([
  ".7z",
  ".avi",
  ".css",
  ".csv",
  ".doc",
  ".docx",
  ".gif",
  ".gz",
  ".ico",
  ".jpeg",
  ".jpg",
  ".js",
  ".json",
  ".mov",
  ".mp3",
  ".mp4",
  ".pdf",
  ".png",
  ".ppt",
  ".pptx",
  ".rar",
  ".svg",
  ".webp",
  ".xls",
  ".xlsx",
  ".zip",
]);

const SKIPPED_PATH_PARTS = [
  "/cart",
  "/checkout",
  "/login",
  "/logout",
  "/search",
  "/signin",
  "/signup",
  "/wp-admin",
];

export const normalizePageUrl = (rawUrl, baseUrl) => {
  try {
    const url = new URL(rawUrl, baseUrl);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    url.hash = "";
    url.username = "";
    url.password = "";
    if (url.pathname !== "/" && url.pathname.endsWith("/")) {
      url.pathname = url.pathname.replace(/\/+$/, "");
    }
    return url.toString();
  } catch {
    return null;
  }
};

export const isSameOrigin = (candidateUrl, siteUrl) => {
  try {
    return new URL(candidateUrl).origin === new URL(siteUrl).origin;
  } catch {
    return false;
  }
};

export const shouldSkipUrl = (candidateUrl) => {
  try {
    const url = new URL(candidateUrl);
    const path = url.pathname.toLowerCase();
    if (SKIPPED_PATH_PARTS.some((part) => path === part || path.startsWith(`${part}/`))) return true;
    const extension = path.match(/\.[a-z0-9]+$/i)?.[0] || "";
    return SKIPPED_EXTENSIONS.has(extension);
  } catch {
    return true;
  }
};

export const uniqueUrls = (urls) => [...new Set(urls.filter(Boolean))];

export const cleanDomain = (rawUrl) => {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./, "");
  } catch {
    return String(rawUrl || "")
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split("/")[0];
  }
};

export const toggleWwwHostname = (rawUrl) => {
  try {
    const url = new URL(rawUrl);
    url.hostname = url.hostname.startsWith("www.")
      ? url.hostname.slice(4)
      : `www.${url.hostname}`;
    return url.toString();
  } catch {
    return null;
  }
};

export const buildCrawlUrlCandidates = (rawUrl) => {
  const normalized = normalizePageUrl(rawUrl, rawUrl);
  if (!normalized) return [];
  const alternate = toggleWwwHostname(normalized);
  return uniqueUrls([normalized, alternate]);
};
