import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyClientError,
  describeSiteCrawlIssue,
  formatAnalyzeToast,
  formatWorkspaceToast,
} from "../client/error-messages.js";
import { createSiteContext } from "../lib/site-context.js";

const createMockFetch = (routes) => async (url) => {
  const requestUrl = typeof url === "string" ? url : url.url;
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

test("classifyClientError distinguishes server unreachable from generic failures", () => {
  const unreachable = classifyClientError(new TypeError("Failed to fetch"));
  assert.equal(unreachable.kind, "server-unreachable");
  assert.match(unreachable.hint, /npm run start/);

  const webkitLoadFailed = classifyClientError(new TypeError("Load failed"));
  assert.equal(webkitLoadFailed.kind, "server-unreachable");

  const timeout = classifyClientError(Object.assign(new Error("Analysis request timed out"), { name: "AbortError" }));
  assert.equal(timeout.kind, "timeout");
});

test("formatAnalyzeToast returns actionable copy for local server failures", () => {
  const toast = formatAnalyzeToast(new TypeError("Failed to fetch"));
  assert.match(toast, /Can't reach local server/);
  assert.match(toast, /127\.0\.0\.1:5279/);
});

test("describeSiteCrawlIssue reports robots-blocked crawl failures", () => {
  const issue = describeSiteCrawlIssue({
    ok: false,
    error: "robots.txt disallows crawling this site for Rankwell's user agent.",
    discovery: { failureKind: "robots-blocked" },
  });
  assert.equal(issue.title, "Crawl blocked by robots.txt");
  assert.match(issue.hint, /without site evidence/);
});

test("formatWorkspaceToast warns when crawl data is limited", () => {
  const toast = formatWorkspaceToast({
    siteContext: {
      ok: false,
      discovery: { failureKind: "robots-blocked" },
      error: "robots.txt disallows crawling this site for Rankwell's user agent.",
    },
    fallbackReason: null,
    draftFallbackReason: null,
  });
  assert.match(toast, /limited data/);
  assert.match(toast, /robots\.txt/);
});

test("createSiteContext marks robots-blocked sites", async () => {
  const fetchImpl = createMockFetch({
    "https://blocked.example/robots.txt": {
      body: ["User-agent: *", "Disallow: /"].join("\n"),
      contentType: "text/plain",
    },
    "https://blocked.example/sitemap.xml": { status: 404, body: "missing", contentType: "text/plain" },
    "https://blocked.example/sitemap_index.xml": { status: 404, body: "missing", contentType: "text/plain" },
    "https://www.blocked.example/robots.txt": {
      body: ["User-agent: *", "Disallow: /"].join("\n"),
      contentType: "text/plain",
    },
    "https://www.blocked.example/sitemap.xml": { status: 404, body: "missing", contentType: "text/plain" },
    "https://www.blocked.example/sitemap_index.xml": { status: 404, body: "missing", contentType: "text/plain" },
  });

  const result = await createSiteContext({ url: "https://blocked.example", fetchImpl });
  assert.equal(result.ok, false);
  assert.equal(result.discovery.failureKind, "robots-blocked");
  assert.match(result.error, /robots\.txt disallows crawling/);
});
