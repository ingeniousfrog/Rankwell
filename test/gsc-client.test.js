import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGscAuthorizationUrl,
  buildSearchAnalyticsRequest,
  getGscOAuthConfig,
  normalizeGscSites,
  resolveGscPropertyForUrl,
} from "../lib/gsc-client.js";

test("getGscOAuthConfig reports missing Google OAuth credentials", () => {
  const config = getGscOAuthConfig({
    env: {},
    port: 5279,
  });

  assert.equal(config.configured, false);
  assert.match(config.message, /GOOGLE_CLIENT_ID/);
});

test("buildGscAuthorizationUrl requests read-only Search Console access", () => {
  const url = buildGscAuthorizationUrl({
    clientId: "client-id",
    redirectUri: "http://127.0.0.1:5279/api/gsc/oauth/callback",
    state: "state-value",
  });

  assert.equal(url.origin, "https://accounts.google.com");
  assert.equal(url.searchParams.get("scope"), "https://www.googleapis.com/auth/webmasters.readonly");
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("include_granted_scopes"), "true");
  assert.equal(url.searchParams.get("state"), "state-value");
});

test("buildSearchAnalyticsRequest keeps GSC dimensions explicit and bounded", () => {
  const request = buildSearchAnalyticsRequest({
    startDate: "2026-05-01",
    endDate: "2026-06-01",
    country: "USA",
    device: "DESKTOP",
  });

  assert.deepEqual(request.dimensions, ["query", "page", "country", "device"]);
  assert.equal(request.type, "web");
  assert.equal(request.rowLimit, 25000);
  assert.deepEqual(request.dimensionFilterGroups, [
    {
      groupType: "and",
      filters: [
        { dimension: "country", operator: "equals", expression: "USA" },
        { dimension: "device", operator: "equals", expression: "DESKTOP" },
      ],
    },
  ]);
});

test("resolveGscPropertyForUrl prefers exact URL prefix and then domain properties", () => {
  const sites = normalizeGscSites({
    siteEntry: [
      { siteUrl: "sc-domain:example.com", permissionLevel: "siteOwner" },
      { siteUrl: "https://example.com/", permissionLevel: "siteFullUser" },
      { siteUrl: "https://other.com/", permissionLevel: "siteFullUser" },
    ],
  });

  assert.equal(resolveGscPropertyForUrl("https://example.com/pricing", sites)?.siteUrl, "https://example.com/");
  assert.equal(resolveGscPropertyForUrl("https://blog.example.com/post", sites)?.siteUrl, "sc-domain:example.com");
});
