import assert from "node:assert/strict";
import test from "node:test";

import { buildDraftPrompt, buildWorkflowPrompt, shrinkSiteContextForPrompt, truncateToMaxChars } from "../lib/ai-prompts.js";
import { extractPageSnapshot } from "../lib/html-extractor.js";
import { isAllowedLocalOrigin, isLikelyPublicHttpUrl } from "../lib/request-security.js";
import { createSiteContext } from "../lib/site-context.js";
import { parseRobotsTxt, parseSitemapXml } from "../lib/site-discovery.js";

const html = (body, head = "") =>
  `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;

const createMockFetch = (routes, calls = []) => async (url) => {
  const requestUrl = typeof url === "string" ? url : url.url;
  calls.push(requestUrl);
  const route = routes[requestUrl];
  if (!route) {
    return new Response("not found", {
      status: 404,
      headers: { "content-type": "text/plain" },
    });
  }
  return new Response(route.body, {
    status: route.status || 200,
    headers: { "content-type": route.contentType || "text/html; charset=utf-8" },
  });
};

test("parseRobotsTxt extracts sitemap URLs and blocks disallowed paths", () => {
  const robots = parseRobotsTxt(
    [
      "User-agent: *",
      "Disallow: /admin",
      "Disallow: /search",
      "Sitemap: https://example.com/sitemap.xml",
    ].join("\n"),
    "https://example.com/",
  );

  assert.deepEqual(robots.sitemaps, ["https://example.com/sitemap.xml"]);
  assert.equal(robots.canCrawl("https://example.com/blog"), true);
  assert.equal(robots.canCrawl("https://example.com/admin/settings"), false);
});

test("parseSitemapXml separates child sitemaps from page URLs", () => {
  const index = parseSitemapXml(
    `<?xml version="1.0"?><sitemapindex>
      <sitemap><loc>https://example.com/pages.xml</loc></sitemap>
    </sitemapindex>`,
    "https://example.com/",
  );
  const pages = parseSitemapXml(
    `<?xml version="1.0"?><urlset>
      <url><loc>https://example.com/</loc></url>
      <url><loc>https://example.com/pricing</loc></url>
    </urlset>`,
    "https://example.com/",
  );

  assert.deepEqual(index.sitemaps, ["https://example.com/pages.xml"]);
  assert.deepEqual(pages.urls, ["https://example.com/", "https://example.com/pricing"]);
});

test("extractPageSnapshot returns grounded page data, links, and image references", () => {
  const page = extractPageSnapshot(
    html(
      `<main>
        <h1>Workflow automation for content teams</h1>
        <h2>Plan</h2>
        <a href="/pricing">Pricing</a>
        <a href="https://other.example/offsite">Offsite</a>
        <img src="/hero.png" alt="Product dashboard" />
        <p>Turn website context into a useful SEO publishing system.</p>
      </main>`,
      `<title>Example Growth OS</title>
       <meta name="description" content="Build useful SEO workflows from your website." />
       <link rel="canonical" href="https://example.com/home" />`,
    ),
    "https://example.com/",
  );

  assert.equal(page.url, "https://example.com/");
  assert.equal(page.canonicalUrl, "https://example.com/home");
  assert.equal(page.title, "Example Growth OS");
  assert.deepEqual(page.headings.h2, ["Plan"]);
  assert.deepEqual(page.links, ["https://example.com/pricing"]);
  assert.deepEqual(page.images, [
    {
      url: "https://example.com/hero.png",
      alt: "Product dashboard",
    },
  ]);
});

test("createSiteContext uses robots sitemap first and skips disallowed pages", async () => {
  const calls = [];
  const fetchImpl = createMockFetch(
    {
      "https://example.com/robots.txt": {
        body: "User-agent: *\nDisallow: /private\nSitemap: https://example.com/sitemap.xml",
        contentType: "text/plain",
      },
      "https://example.com/sitemap.xml": {
        body: `<?xml version="1.0"?><urlset>
          <url><loc>https://example.com/</loc></url>
          <url><loc>https://example.com/pricing</loc></url>
          <url><loc>https://example.com/private</loc></url>
        </urlset>`,
        contentType: "application/xml",
      },
      "https://example.com/": {
        body: html("<h1>Home</h1><p>AI SEO workflow for founders.</p>"),
      },
      "https://example.com/pricing": {
        body: html("<h1>Pricing</h1><p>Simple plans for lean teams.</p>"),
      },
    },
    calls,
  );

  const context = await createSiteContext({
    url: "https://example.com/",
    fetchImpl,
    limits: { maxPages: 10, maxDepth: 2 },
  });

  assert.equal(context.ok, true);
  assert.equal(context.discovery.strategy, "sitemap");
  assert.deepEqual(
    context.pages.map((page) => page.url),
    ["https://example.com/", "https://example.com/pricing"],
  );
  assert.equal(calls.includes("https://example.com/private"), false);
  assert.ok(context.events.some((event) => event.type === "page" && event.status === "pass"));
});

test("createSiteContext retries apex domain when www host fails", async () => {
  const fetchImpl = createMockFetch({
    "https://www.example.com/robots.txt": {
      status: 502,
      body: "bad gateway",
      contentType: "text/plain",
    },
    "https://www.example.com/sitemap.xml": {
      status: 502,
      body: "bad gateway",
      contentType: "text/plain",
    },
    "https://example.com/robots.txt": {
      body: "User-agent: *\nSitemap: https://example.com/sitemap.xml",
      contentType: "text/plain",
    },
    "https://example.com/sitemap.xml": {
      body: `<?xml version="1.0"?><urlset>
        <url><loc>https://example.com/</loc></url>
      </urlset>`,
      contentType: "application/xml",
    },
    "https://example.com/": {
      body: html("<h1>Home</h1><p>Public homepage.</p>"),
    },
  });

  const context = await createSiteContext({
    url: "https://www.example.com/",
    fetchImpl,
    limits: { maxPages: 5, maxDepth: 1 },
  });

  assert.equal(context.ok, true);
  assert.equal(context.startUrl, "https://example.com/");
  assert.equal(context.requestedStartUrl, "https://www.example.com/");
  assert.ok(context.events.some((event) => event.type === "url-fallback"));
});

test("createSiteContext explains crawl failure when all URL variants fail", async () => {
  const fetchImpl = createMockFetch({
    "https://www.example.com/robots.txt": { status: 502, body: "bad gateway", contentType: "text/plain" },
    "https://www.example.com/sitemap.xml": { status: 502, body: "bad gateway", contentType: "text/plain" },
    "https://www.example.com/": { status: 502, body: "bad gateway", contentType: "text/html" },
    "https://example.com/robots.txt": { status: 502, body: "bad gateway", contentType: "text/plain" },
    "https://example.com/sitemap.xml": { status: 502, body: "bad gateway", contentType: "text/plain" },
    "https://example.com/": { status: 502, body: "bad gateway", contentType: "text/html" },
  });

  const context = await createSiteContext({
    url: "https://www.example.com/",
    fetchImpl,
    limits: { maxPages: 2, maxDepth: 0 },
  });

  assert.equal(context.ok, false);
  assert.match(context.error, /without www/i);
  assert.deepEqual(context.attemptedUrls, ["https://www.example.com/", "https://example.com/"]);
  assert.ok(context.failures.some((failure) => failure.url === "https://www.example.com/"));
  assert.ok(context.failures.some((failure) => failure.url === "https://example.com/"));
});

test("createSiteContext preserves low-level fetch failure causes", async () => {
  const fetchImpl = async () => {
    const cause = Object.assign(new Error("socket disconnected before TLS"), { code: "ECONNRESET" });
    throw new TypeError("fetch failed", { cause });
  };

  const context = await createSiteContext({
    url: "https://example.com/",
    fetchImpl,
    limits: { maxPages: 1, maxDepth: 0, maxSitemaps: 1 },
  });

  assert.equal(context.ok, false);
  assert.ok(context.failures.some((failure) => /ECONNRESET|socket disconnected before TLS/.test(failure.reason)));
});

test("createSiteContext falls back to same-origin crawl when no sitemap is available", async () => {
  const fetchImpl = createMockFetch({
    "https://example.com/robots.txt": {
      status: 404,
      body: "missing",
      contentType: "text/plain",
    },
    "https://example.com/": {
      body: html('<h1>Home</h1><a href="/features">Features</a><a href="/asset.pdf">PDF</a>'),
    },
    "https://example.com/features": {
      body: html("<h1>Features</h1><p>Research content gaps across a site.</p>"),
    },
  });

  const context = await createSiteContext({
    url: "https://example.com/",
    fetchImpl,
    limits: { maxPages: 5, maxDepth: 2 },
  });

  assert.equal(context.discovery.strategy, "crawl");
  assert.deepEqual(
    context.pages.map((page) => page.url),
    ["https://example.com/", "https://example.com/features"],
  );
});

test("AI prompts require siteContext, real evidence URLs, and visual generation details", () => {
  const workflowPrompt = buildWorkflowPrompt(
    { url: "https://example.com/", domain: "example.com", planLength: 5 },
    { ok: true, pages: [{ url: "https://example.com/", title: "Home" }] },
  );
  const workflowPromptWithDraft = buildWorkflowPrompt(
    { url: "https://example.com/", domain: "example.com", planLength: 5, includeDraft: true },
    { ok: true, pages: [{ url: "https://example.com/", title: "Home" }] },
  );
  const draftPrompt = buildDraftPrompt(
    { url: "https://example.com/", domain: "example.com" },
    { title: "Topic", keyword: "seo workflow" },
    [],
    { ok: true, pages: [{ url: "https://example.com/", title: "Home" }] },
  );

  assert.match(workflowPrompt.instructions, /siteContext/);
  assert.match(workflowPrompt.instructions, /url, pageTitle, source, quote, usedFor/);
  assert.match(workflowPrompt.instructions, /prompt, negativePrompt, referenceImages, altText/);
  assert.match(workflowPrompt.message, /"siteContext"/);
  assert.match(workflowPrompt.instructions, /placementUrl/);
  assert.match(workflowPrompt.instructions, /calendar\[5\]/);
  assert.match(workflowPrompt.instructions, /drafts\[0\]/);
  assert.match(workflowPrompt.instructions, /Do not write a starter draft/);
  assert.match(workflowPromptWithDraft.instructions, /drafts\[1\]/);
  assert.match(draftPrompt.instructions, /placementUrl/);
});

test("truncateToMaxChars keeps UTF-8 boundaries and marks omitted content", () => {
  const text = "你好世界".repeat(200);
  const truncated = truncateToMaxChars(text, 120, "pageText truncated");
  assert.ok(Buffer.byteLength(truncated, "utf8") <= 120);
  assert.match(truncated, /\[pageText truncated \d+ chars\]/);
});

test("shrinkSiteContextForPrompt keeps prompt message under the byte budget", () => {
  const pages = Array.from({ length: 60 }, (_, index) => ({
    url: `https://example.com/page-${index}`,
    title: `Page ${index}`,
    pageType: index === 0 ? "home" : "page",
    pageText: "Lorem ipsum dolor sit amet. ".repeat(120),
    images: [{ url: `https://example.com/image-${index}.png` }],
  }));
  const compact = shrinkSiteContextForPrompt({ ok: true, pages }, 8_000);
  const messageBytes = Buffer.byteLength(JSON.stringify({ siteContext: compact }), "utf8");
  assert.ok(messageBytes <= 8_000);
  assert.equal(compact.pages[0]?.pageType, "home");
  assert.ok(compact.pages.length <= 24);
});

test("request security allows local API origins and rejects cross-site origins", () => {
  assert.equal(isAllowedLocalOrigin({}, 5279), true);
  assert.equal(isAllowedLocalOrigin({ origin: "http://127.0.0.1:5279" }, 5279), true);
  assert.equal(isAllowedLocalOrigin({ origin: "http://localhost:5279" }, 5279), true);
  assert.equal(isAllowedLocalOrigin({ origin: "https://evil.example" }, 5279), false);
});

test("request security rejects private crawl targets by default", () => {
  assert.equal(isLikelyPublicHttpUrl("https://example.com"), true);
  assert.equal(isLikelyPublicHttpUrl("file:///etc/passwd"), false);
  assert.equal(isLikelyPublicHttpUrl("http://localhost:3000"), false);
  assert.equal(isLikelyPublicHttpUrl("http://127.0.0.1:3000"), false);
  assert.equal(isLikelyPublicHttpUrl("http://192.168.1.5"), false);
  assert.equal(isLikelyPublicHttpUrl("http://192.168.1.5", { allowPrivateTargets: true }), true);
});
