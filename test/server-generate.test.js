import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(new URL("../server.js", import.meta.url)));

const listen = (server, port = 0) =>
  new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server.address().port);
    });
  });

const closeServer = (server) =>
  new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });

const getFreePort = async () => {
  const server = http.createServer();
  const port = await listen(server);
  await closeServer(server);
  return port;
};

const waitForApp = async (port, child) => {
  const deadline = Date.now() + 5_000;
  let lastError = null;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/provider/status`);
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`App server did not become ready: ${lastError?.message || "child exited"}`);
};

const stopChild = async (child) => {
  if (child.exitCode !== null) return;
  child.kill();
  await new Promise((resolve) => child.once("exit", resolve));
};

test("POST /api/generate returns crawled site context instead of crashing before crawl", async () => {
  const mockSite = http.createServer((req, res) => {
    if (req.url === "/robots.txt") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("User-agent: *\nSitemap: /sitemap.xml");
      return;
    }
    if (req.url === "/sitemap.xml") {
      res.writeHead(200, { "content-type": "application/xml" });
      res.end(`<?xml version="1.0"?><urlset>
        <url><loc>http://127.0.0.1:${mockSite.address().port}/</loc></url>
      </urlset>`);
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end("<!doctype html><title>Mock Product</title><h1>Mock Product</h1><p>AI video workflow for marketers.</p>");
  });
  const mockSitePort = await listen(mockSite);
  const appPort = await getFreePort();
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "rankwell-codex-home-"));
  const child = spawn(process.execPath, ["server.js"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      ALLOW_PRIVATE_TARGETS: "1",
      CODEX_HOME: codexHome,
      PORT: String(appPort),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stderr = [];
  child.stderr.on("data", (chunk) => stderr.push(String(chunk)));

  try {
    await waitForApp(appPort, child);
    const response = await fetch(`http://127.0.0.1:${appPort}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: `http://127.0.0.1:${mockSitePort}/`,
        domain: "mock.local",
        planLength: 5,
      }),
    });
    const payload = await response.json();

    assert.equal(response.status, 200, JSON.stringify(payload));
    assert.equal(payload.provider, "local-rules");
    assert.equal(payload.workflow.siteContext.ok, true);
    assert.equal(payload.workflow.siteContext.discovery.pagesFetched, 1);
    assert.equal(payload.workflow.inputs.planLength, 5);
    assert.equal(payload.workflow.calendar.length, 5);
    assert.equal(payload.workflow.inputs.includeDraft, false);
    assert.equal(payload.workflow.drafts.length, 0);
    assert.match(payload.workflow.siteContext.pages[0].title, /Mock Product/);
  } finally {
    await stopChild(child);
    await closeServer(mockSite);
  }

  assert.deepEqual(stderr, []);
});

test("POST /api/draft accepts compact requests without embedded siteContext", async () => {
  const appPort = await getFreePort();
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "rankwell-codex-home-"));
  const child = spawn(process.execPath, ["server.js"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      CODEX_HOME: codexHome,
      PORT: String(appPort),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    await waitForApp(appPort, child);
    const response = await fetch(`http://127.0.0.1:${appPort}/api/draft`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        input: { url: "https://example.com", domain: "example.com", planLength: 7 },
        calendarItem: { title: "Example topic", keyword: "example keyword" },
        existingTitles: [],
      }),
    });
    const payload = await response.json();

    assert.equal(response.status, 200, JSON.stringify(payload));
    assert.equal(payload.provider, "local-rules");
    assert.equal(payload.draft.title, "Example topic");
  } finally {
    await stopChild(child);
  }
});

test("POST /api/draft routes refresh and expand modes to opportunity briefs", async () => {
  const appPort = await getFreePort();
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "rankwell-codex-home-"));
  const child = spawn(process.execPath, ["server.js"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      CODEX_HOME: codexHome,
      PORT: String(appPort),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    await waitForApp(appPort, child);
    const siteContext = {
      ok: true,
      startUrl: "https://example.com/",
      pages: [
        {
          url: "https://example.com/blog/content-brief",
          title: "Content Brief Workflow",
          h1: "How to build content briefs",
          pageText: "A workflow for content briefs, approvals, examples, and publishing.",
        },
      ],
    };
    const baseBody = {
      input: { url: "https://example.com", domain: "example.com", planLength: 7 },
      existingTitles: [],
      siteContext,
    };
    const refreshResponse = await fetch(`http://127.0.0.1:${appPort}/api/draft`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...baseBody,
        calendarItem: {
          id: "plan-refresh-1",
          title: "Refresh content brief template",
          keyword: "content brief template",
          draftMode: "refreshBrief",
          opportunityType: "refresh",
          targetUrl: "https://example.com/blog/content-brief",
          opportunityMetrics: { impressions: 800, clicks: 8, ctr: 0.01, position: 12.4 },
          recommendedActions: ["Rewrite title", "Add FAQ"],
        },
      }),
    });
    const refreshPayload = await refreshResponse.json();

    assert.equal(refreshResponse.status, 200, JSON.stringify(refreshPayload));
    assert.equal(refreshPayload.provider, "opportunity-rules");
    assert.equal(refreshPayload.draft.draftMode, "refreshBrief");
    assert.equal(refreshPayload.draft.sourceCalendarItemId, "plan-refresh-1");
    assert.equal(refreshPayload.draft.targetUrl, "https://example.com/blog/content-brief");
    assert.equal(refreshPayload.draft.templateId, "refreshBrief");
    assert.ok(refreshPayload.draft.blocks.some((block) => /Title|Meta/i.test(block.heading)));

    const expandResponse = await fetch(`http://127.0.0.1:${appPort}/api/draft`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...baseBody,
        calendarItem: {
          id: "plan-expand-1",
          title: "Expand Content Brief Workflow",
          keyword: "content brief examples",
          draftMode: "expandBrief",
          opportunityType: "expand",
          targetUrl: "https://example.com/blog/content-brief",
          queries: [
            { query: "content brief template", impressions: 800 },
            { query: "content brief example", impressions: 520 },
          ],
        },
      }),
    });
    const expandPayload = await expandResponse.json();

    assert.equal(expandResponse.status, 200, JSON.stringify(expandPayload));
    assert.equal(expandPayload.provider, "opportunity-rules");
    assert.equal(expandPayload.draft.draftMode, "expandBrief");
    assert.equal(expandPayload.draft.sourceCalendarItemId, "plan-expand-1");
    assert.equal(expandPayload.draft.templateId, "expandBrief");
    assert.ok(expandPayload.draft.blocks.some((block) => /Insertion|section/i.test(`${block.heading} ${block.body}`)));
  } finally {
    await stopChild(child);
  }
});

test("POST /api/draft rejects governance tasks with a clear JSON error", async () => {
  const appPort = await getFreePort();
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "rankwell-codex-home-"));
  const child = spawn(process.execPath, ["server.js"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      CODEX_HOME: codexHome,
      PORT: String(appPort),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    await waitForApp(appPort, child);
    const response = await fetch(`http://127.0.0.1:${appPort}/api/draft`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        input: { url: "https://example.com", domain: "example.com", planLength: 7 },
        calendarItem: {
          id: "plan-governance-1",
          title: "Resolve split ranking for seo content planner",
          keyword: "seo content planner",
          draftMode: "governance",
          opportunityType: "cannibalization",
          targetUrl: "https://example.com/features/planner",
        },
        existingTitles: [],
      }),
    });
    const payload = await response.json();

    assert.equal(response.status, 400);
    assert.match(payload.error, /Governance task/i);
  } finally {
    await stopChild(child);
  }
});

test("POST /api/draft rejects oversized request bodies with JSON error", async () => {
  const appPort = await getFreePort();
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "rankwell-codex-home-"));
  const child = spawn(process.execPath, ["server.js"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      CODEX_HOME: codexHome,
      PORT: String(appPort),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    await waitForApp(appPort, child);
    const hugeSiteContext = {
      ok: true,
      pages: Array.from({ length: 50 }, (_, index) => ({
        url: `https://example.com/page-${index}`,
        pageText: "x".repeat(1800),
      })),
    };
    const response = await fetch(`http://127.0.0.1:${appPort}/api/draft`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        input: { url: "https://example.com", domain: "example.com", planLength: 7 },
        calendarItem: { title: "Example topic", keyword: "example keyword" },
        existingTitles: [],
        siteContext: hugeSiteContext,
      }),
    });
    const payload = await response.json();

    assert.equal(response.status, 400);
    assert.match(payload.error, /too large/i);
  } finally {
    await stopChild(child);
  }
});
