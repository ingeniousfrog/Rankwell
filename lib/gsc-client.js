import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { normalizeSearchAnalyticsRows } from "./seo-opportunities.js";

export const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GSC_API_BASE = "https://www.googleapis.com/webmasters/v3";
const TOKEN_REFRESH_SKEW_MS = 60_000;
const DEFAULT_ROW_LIMIT = 25_000;
const DEFAULT_LOOKBACK_DAYS = 90;
const DEFAULT_DATA_LAG_DAYS = 3;

const cleanString = (value) => (typeof value === "string" ? value.trim() : "");

const formatDate = (date) => date.toISOString().slice(0, 10);

const addDays = (date, days) => {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};

export const getGscDateRange = (now = new Date()) => {
  const end = addDays(now, -DEFAULT_DATA_LAG_DAYS);
  const start = addDays(end, -DEFAULT_LOOKBACK_DAYS);
  return {
    startDate: formatDate(start),
    endDate: formatDate(end),
  };
};

export const getGscOAuthConfig = ({ env = process.env, port = 5279 } = {}) => {
  const clientId = cleanString(env.GOOGLE_CLIENT_ID);
  const clientSecret = cleanString(env.GOOGLE_CLIENT_SECRET);
  const redirectUri =
    cleanString(env.GOOGLE_REDIRECT_URI) || `http://127.0.0.1:${port}/api/gsc/oauth/callback`;
  const configured = Boolean(clientId && clientSecret);

  return {
    configured,
    clientId,
    clientSecret,
    redirectUri,
    scope: GSC_SCOPE,
    message: configured
      ? "Google Search Console OAuth is configured."
      : "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to enable Google Search Console OAuth.",
  };
};

export const getGscTokenPath = ({ env = process.env, homeDir = os.homedir() } = {}) => {
  const explicitPath = cleanString(env.RANKWELL_GSC_TOKEN_PATH);
  if (explicitPath) return explicitPath;
  const rankwellHome = cleanString(env.RANKWELL_HOME) || path.join(homeDir, ".rankwell");
  return path.join(rankwellHome, "gsc-token.json");
};

export const buildGscAuthorizationUrl = ({ clientId, redirectUri, state }) => {
  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GSC_SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  return url;
};

export const buildSearchAnalyticsRequest = ({
  startDate,
  endDate,
  country = "",
  device = "",
  dimensions = ["query", "page", "country", "device"],
  rowLimit = DEFAULT_ROW_LIMIT,
  startRow = 0,
  type = "web",
} = {}) => {
  const filters = [
    country ? { dimension: "country", operator: "equals", expression: country } : null,
    device ? { dimension: "device", operator: "equals", expression: device } : null,
  ].filter(Boolean);

  return {
    startDate,
    endDate,
    dimensions,
    type,
    rowLimit: Math.max(1, Math.min(DEFAULT_ROW_LIMIT, Number(rowLimit) || DEFAULT_ROW_LIMIT)),
    startRow: Math.max(0, Number(startRow) || 0),
    ...(filters.length
      ? {
          dimensionFilterGroups: [
            {
              groupType: "and",
              filters,
            },
          ],
        }
      : {}),
  };
};

export const normalizeGscSites = (payload) =>
  (Array.isArray(payload?.siteEntry) ? payload.siteEntry : [])
    .map((site) => ({
      siteUrl: cleanString(site.siteUrl),
      permissionLevel: cleanString(site.permissionLevel),
    }))
    .filter((site) => site.siteUrl && site.permissionLevel !== "siteUnverifiedUser");

const hostnameFor = (rawUrl) => {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
};

const isDomainPropertyMatch = (siteUrl, targetHost) => {
  if (!siteUrl.startsWith("sc-domain:") || !targetHost) return false;
  const domain = siteUrl.slice("sc-domain:".length).replace(/^www\./, "").toLowerCase();
  return targetHost === domain || targetHost.endsWith(`.${domain}`);
};

export const resolveGscPropertyForUrl = (rawUrl, sites) => {
  const url = cleanString(rawUrl);
  const targetHost = hostnameFor(url);
  const entries = Array.isArray(sites) ? sites : normalizeGscSites(sites);
  const urlPrefixMatches = entries
    .filter((site) => !site.siteUrl.startsWith("sc-domain:") && url.startsWith(site.siteUrl))
    .sort((left, right) => right.siteUrl.length - left.siteUrl.length);

  if (urlPrefixMatches[0]) return urlPrefixMatches[0];
  return entries.find((site) => isDomainPropertyMatch(site.siteUrl, targetHost)) || null;
};

export const readGscTokens = ({ tokenPath = getGscTokenPath() } = {}) => {
  if (!fs.existsSync(tokenPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(tokenPath, "utf8"));
  } catch {
    return null;
  }
};

export const writeGscTokens = (tokens, { tokenPath = getGscTokenPath() } = {}) => {
  fs.mkdirSync(path.dirname(tokenPath), { recursive: true });
  const tmp = `${tokenPath}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(tokens, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(tmp, tokenPath);
  fs.chmodSync(tokenPath, 0o600);
};

const storedTokenFromPayload = (payload, existing = null, now = new Date()) => ({
  access_token: payload.access_token || existing?.access_token || "",
  refresh_token: payload.refresh_token || existing?.refresh_token || "",
  scope: payload.scope || existing?.scope || GSC_SCOPE,
  token_type: payload.token_type || existing?.token_type || "Bearer",
  expires_at: payload.expires_in
    ? new Date(now.getTime() + Number(payload.expires_in) * 1000).toISOString()
    : existing?.expires_at || "",
  updated_at: now.toISOString(),
});

const postForm = async (url, params, fetchImpl = fetch) => {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { error_description: text };
  }
  if (!response.ok) {
    const detail = payload.error_description || payload.error || `HTTP ${response.status}`;
    throw new Error(`Google Search Console OAuth failed: ${detail}`);
  }
  return payload;
};

export const exchangeGscCodeForTokens = async ({
  code,
  config,
  tokenPath = getGscTokenPath(),
  fetchImpl = fetch,
  now = new Date(),
}) => {
  const payload = await postForm(
    GOOGLE_TOKEN_URL,
    {
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code",
    },
    fetchImpl,
  );
  const tokens = storedTokenFromPayload(payload, readGscTokens({ tokenPath }), now);
  writeGscTokens(tokens, { tokenPath });
  return tokens;
};

export const readGscStatus = ({ env = process.env, port = 5279 } = {}) => {
  const config = getGscOAuthConfig({ env, port });
  const tokenPath = getGscTokenPath({ env });
  const tokens = readGscTokens({ tokenPath });
  const authorized = Boolean(tokens?.refresh_token || tokens?.access_token);

  return {
    configured: config.configured,
    authorized,
    scope: config.scope,
    redirectUri: config.redirectUri,
    tokenPath,
    message: !config.configured
      ? config.message
      : authorized
        ? "Google Search Console is authorized for owned-site performance data."
        : "Connect Google Search Console to use impressions, CTR, average position, and landing page data.",
  };
};

const shouldRefresh = (tokens, now = new Date()) => {
  if (!tokens?.access_token) return true;
  if (!tokens.expires_at) return false;
  const expiresAt = Date.parse(tokens.expires_at);
  if (Number.isNaN(expiresAt)) return true;
  return expiresAt - now.getTime() <= TOKEN_REFRESH_SKEW_MS;
};

export const refreshGscTokens = async ({
  tokens,
  config,
  tokenPath = getGscTokenPath(),
  fetchImpl = fetch,
  now = new Date(),
}) => {
  if (!tokens?.refresh_token) {
    throw new Error("Google Search Console refresh_token is missing. Reconnect Google OAuth.");
  }
  const payload = await postForm(
    GOOGLE_TOKEN_URL,
    {
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: tokens.refresh_token,
      grant_type: "refresh_token",
    },
    fetchImpl,
  );
  const nextTokens = storedTokenFromPayload(payload, tokens, now);
  writeGscTokens(nextTokens, { tokenPath });
  return nextTokens;
};

export const getGscAccessToken = async ({
  env = process.env,
  port = 5279,
  tokenPath = getGscTokenPath({ env }),
  fetchImpl = fetch,
  now = new Date(),
} = {}) => {
  const config = getGscOAuthConfig({ env, port });
  if (!config.configured) throw new Error(config.message);

  const tokens = readGscTokens({ tokenPath });
  if (!tokens) throw new Error("Google Search Console is not authorized yet.");
  if (!shouldRefresh(tokens, now)) return tokens.access_token;

  const refreshed = await refreshGscTokens({ tokens, config, tokenPath, fetchImpl, now });
  return refreshed.access_token;
};

const fetchJson = async (url, options, fetchImpl = fetch) => {
  const response = await fetchImpl(url, options);
  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { error: text };
  }
  if (!response.ok) {
    const detail = payload.error?.message || payload.error_description || payload.error || `HTTP ${response.status}`;
    throw new Error(`Google Search Console API failed: ${detail}`);
  }
  return payload;
};

export const listGscSites = async ({ accessToken, fetchImpl = fetch } = {}) => {
  const payload = await fetchJson(
    `${GSC_API_BASE}/sites`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
    fetchImpl,
  );
  return normalizeGscSites(payload);
};

export const queryGscSearchAnalytics = async ({
  accessToken,
  siteUrl,
  request,
  fetchImpl = fetch,
} = {}) => {
  const payload = await fetchJson(
    `${GSC_API_BASE}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    },
    fetchImpl,
  );
  return {
    raw: payload,
    rows: normalizeSearchAnalyticsRows(payload, request.dimensions),
  };
};

export const fetchGscPerformanceForUrl = async ({
  url,
  env = process.env,
  port = 5279,
  fetchImpl = fetch,
  now = new Date(),
  country = "",
  device = "",
  startDate = "",
  endDate = "",
} = {}) => {
  const config = getGscOAuthConfig({ env, port });
  const tokenPath = getGscTokenPath({ env });
  const accessToken = await getGscAccessToken({ env, port, tokenPath, fetchImpl, now });
  const sites = await listGscSites({ accessToken, fetchImpl });
  const property = resolveGscPropertyForUrl(url, sites);
  if (!property) {
    return {
      status: "no-property",
      message: "The connected Google account does not expose a verified Search Console property for this URL.",
      propertyUrl: "",
      rows: [],
      rowCount: 0,
      sites,
    };
  }

  const dateRange = startDate && endDate ? { startDate, endDate } : getGscDateRange(now);
  const request = buildSearchAnalyticsRequest({
    ...dateRange,
    country,
    device,
  });
  const response = await queryGscSearchAnalytics({
    accessToken,
    siteUrl: property.siteUrl,
    request,
    fetchImpl,
  });

  return {
    status: "connected",
    message: "Google Search Console performance data loaded.",
    propertyUrl: property.siteUrl,
    permissionLevel: property.permissionLevel,
    dateRange,
    request,
    rows: response.rows,
    rowCount: response.rows.length,
    sites,
  };
};
