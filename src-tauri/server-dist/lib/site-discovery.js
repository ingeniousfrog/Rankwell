import { isSameOrigin, normalizePageUrl, shouldSkipUrl, uniqueUrls } from "./url-utils.js";

const stripXmlTags = (value) =>
  String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .trim();

const cleanRobotsLine = (line) => line.replace(/#.*/, "").trim();

const pathMatches = (path, rule) => {
  if (!rule) return false;
  if (rule === "/") return true;
  return path === rule || path.startsWith(rule);
};

export const parseRobotsTxt = (text, siteUrl) => {
  const sitemaps = [];
  const disallowRules = [];
  const allowRules = [];
  let appliesToUs = false;

  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const line = cleanRobotsLine(rawLine);
    if (!line) continue;
    const [rawKey, ...rawValue] = line.split(":");
    const key = rawKey.trim().toLowerCase();
    const value = rawValue.join(":").trim();

    if (key === "sitemap") {
      const sitemapUrl = normalizePageUrl(value, siteUrl);
      if (sitemapUrl) sitemaps.push(sitemapUrl);
      continue;
    }

    if (key === "user-agent") {
      const agent = value.toLowerCase();
      appliesToUs = agent === "*" || agent.includes("rankwell");
      continue;
    }

    if (!appliesToUs) continue;
    if (key === "disallow" && value) disallowRules.push(value);
    if (key === "allow" && value) allowRules.push(value);
  }

  const canCrawl = (candidateUrl) => {
    const url = new URL(candidateUrl, siteUrl);
    if (!isSameOrigin(url.toString(), siteUrl)) return false;
    const path = url.pathname || "/";
    const matchingDisallow = disallowRules.filter((rule) => pathMatches(path, rule)).sort((a, b) => b.length - a.length)[0];
    if (!matchingDisallow) return true;
    const matchingAllow = allowRules.filter((rule) => pathMatches(path, rule)).sort((a, b) => b.length - a.length)[0];
    return Boolean(matchingAllow && matchingAllow.length >= matchingDisallow.length);
  };

  return {
    sitemaps: uniqueUrls(sitemaps),
    disallowRules,
    allowRules,
    canCrawl,
  };
};

const extractLastmod = (block) => {
  const match = block.match(/<lastmod[^>]*>([\s\S]*?)<\/lastmod>/i);
  return match ? stripXmlTags(match[1]) : "";
};

export const parseSitemapXml = (xml, siteUrl) => {
  const urlBlocks = [...String(xml || "").matchAll(/<url>([\s\S]*?)<\/url>/gi)].map((match) => match[1]);
  const locEntries = urlBlocks.length
    ? urlBlocks
        .map((block) => {
          const locMatch = block.match(/<loc[^>]*>([\s\S]*?)<\/loc>/i);
          const url = locMatch ? normalizePageUrl(stripXmlTags(locMatch[1]), siteUrl) : "";
          if (!url || !isSameOrigin(url, siteUrl)) return null;
          return { url, lastmod: extractLastmod(block) };
        })
        .filter(Boolean)
    : [...String(xml || "").matchAll(/<loc[^>]*>([\s\S]*?)<\/loc>/gi)]
        .map((match) => {
          const url = normalizePageUrl(stripXmlTags(match[1]), siteUrl);
          if (!url || !isSameOrigin(url, siteUrl)) return null;
          return { url, lastmod: "" };
        })
        .filter(Boolean);

  const entries = locEntries.map((entry) => entry.url);
  const urlMeta = locEntries.reduce((acc, entry) => {
    if (entry.lastmod) acc[entry.url] = { lastmod: entry.lastmod };
    return acc;
  }, {});

  const isIndex = /<sitemapindex[\s>]/i.test(xml);
  const pageUrls = isIndex ? [] : entries.filter((url) => !shouldSkipUrl(url));
  const sitemapUrls = isIndex ? entries : entries.filter((url) => /sitemap|\.xml(\?|$)/i.test(url));

  return {
    sitemaps: uniqueUrls(sitemapUrls),
    urls: uniqueUrls(pageUrls),
    urlMeta,
  };
};

export const getRobotsUrl = (siteUrl) => {
  const url = new URL(siteUrl);
  return `${url.origin}/robots.txt`;
};

export const getDefaultSitemapUrls = (siteUrl) => {
  const url = new URL(siteUrl);
  return [`${url.origin}/sitemap.xml`, `${url.origin}/sitemap_index.xml`];
};
