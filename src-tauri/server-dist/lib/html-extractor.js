import { isSameOrigin, normalizePageUrl, shouldSkipUrl, uniqueUrls } from "./url-utils.js";

export const compactWhitespace = (text) => String(text || "").replace(/\s+/g, " ").trim();

const decodeHtmlEntities = (text) =>
  String(text || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#39;/g, "'");

const stripTags = (html) => compactWhitespace(decodeHtmlEntities(String(html || "").replace(/<[^>]+>/g, " ")));

const getAttribute = (tag, name) => {
  const pattern = new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, "i");
  return tag.match(pattern)?.[1] || "";
};

const extractTagContent = (html, tagName, limit = 240) => {
  const match = html.match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  return match ? stripTags(match[1]).slice(0, limit) : "";
};

const extractAllTagContent = (html, tagName, limit = 120) =>
  [...html.matchAll(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "gi"))]
    .map((match) => stripTags(match[1]).slice(0, limit))
    .filter(Boolean)
    .slice(0, 12);

const extractMetaDescription = (html) => {
  const tags = [...html.matchAll(/<meta\s+[^>]*>/gi)].map((match) => match[0]);
  const tag = tags.find((item) => getAttribute(item, "name").toLowerCase() === "description");
  return compactWhitespace(decodeHtmlEntities(getAttribute(tag || "", "content"))).slice(0, 320);
};

const extractCanonicalUrl = (html, pageUrl) => {
  const tags = [...html.matchAll(/<link\s+[^>]*>/gi)].map((match) => match[0]);
  const tag = tags.find((item) => getAttribute(item, "rel").toLowerCase() === "canonical");
  return tag ? normalizePageUrl(getAttribute(tag, "href"), pageUrl) : "";
};

const extractLinks = (html, pageUrl) =>
  uniqueUrls(
    [...html.matchAll(/<a\s+[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/gi)]
      .map((match) => normalizePageUrl(match[1], pageUrl))
      .filter((url) => url && isSameOrigin(url, pageUrl) && !shouldSkipUrl(url)),
  ).slice(0, 80);

const extractImages = (html, pageUrl) =>
  [...html.matchAll(/<img\s+[^>]*>/gi)]
    .map((match) => {
      const tag = match[0];
      const src = getAttribute(tag, "src") || getAttribute(tag, "data-src");
      const url = src ? normalizePageUrl(src, pageUrl) : null;
      if (!url) return null;
      return {
        url,
        alt: compactWhitespace(decodeHtmlEntities(getAttribute(tag, "alt"))).slice(0, 180),
      };
    })
    .filter(Boolean)
    .slice(0, 10);

const htmlToText = (html) =>
  stripTags(
    String(html || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<svg[\s\S]*?<\/svg>/gi, " "),
  );

const inferPageType = (pageUrl, title, h1) => {
  const path = new URL(pageUrl).pathname.toLowerCase();
  const joined = `${path} ${title} ${h1}`.toLowerCase();
  if (path === "/") return "home";
  if (joined.includes("pricing")) return "pricing";
  if (joined.includes("blog") || joined.includes("article")) return "blog";
  if (joined.includes("docs") || joined.includes("documentation")) return "docs";
  if (joined.includes("case-stud") || joined.includes("customer")) return "proof";
  if (joined.includes("feature") || joined.includes("product")) return "product";
  if (joined.includes("about")) return "about";
  return "page";
};

export const extractPageSnapshot = (html, pageUrl) => {
  const normalizedUrl = normalizePageUrl(pageUrl, pageUrl) || pageUrl;
  const title = extractTagContent(html, "title");
  const h1 = extractTagContent(html, "h1");
  const pageText = htmlToText(html);
  const headings = {
    h1: h1 ? [h1] : [],
    h2: extractAllTagContent(html, "h2"),
    h3: extractAllTagContent(html, "h3"),
  };

  return {
    url: normalizedUrl,
    canonicalUrl: extractCanonicalUrl(html, normalizedUrl),
    title,
    metaDescription: extractMetaDescription(html),
    h1,
    headings,
    pageType: inferPageType(normalizedUrl, title, h1),
    links: extractLinks(html, normalizedUrl),
    images: extractImages(html, normalizedUrl),
    wordCount: pageText ? pageText.split(/\s+/).length : 0,
    pageText: pageText.slice(0, 1800),
  };
};
