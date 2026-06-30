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
