import net from "node:net";

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

const isPrivateIpv4 = (hostname) => {
  const parts = hostname.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 169 && b === 254) ||
    (a === 192 && b === 168) ||
    a === 0
  );
};

const isPrivateIpv6 = (hostname) => {
  const value = hostname.toLowerCase();
  return value === "::1" || value.startsWith("fc") || value.startsWith("fd") || value.startsWith("fe80");
};

const isPrivateHostname = (hostname) => {
  const clean = hostname.toLowerCase().replace(/\.$/, "");
  if (LOCAL_HOSTNAMES.has(clean) || clean.endsWith(".localhost")) return true;
  const ipVersion = net.isIP(clean);
  if (ipVersion === 4) return isPrivateIpv4(clean);
  if (ipVersion === 6) return isPrivateIpv6(clean);
  return false;
};

export const isLikelyPublicHttpUrl = (rawUrl, { allowPrivateTargets = false } = {}) => {
  try {
    const url = new URL(rawUrl);
    if (!["http:", "https:"].includes(url.protocol)) return false;
    return allowPrivateTargets || !isPrivateHostname(url.hostname);
  } catch {
    return false;
  }
};

export const isAllowedLocalOrigin = (headers, port) => {
  const origin = headers?.origin;
  if (!origin) return true;
  try {
    const url = new URL(origin);
    const expectedPort = String(port);
    const isLocalHost = LOCAL_HOSTNAMES.has(url.hostname.toLowerCase());
    return ["http:", "https:"].includes(url.protocol) && isLocalHost && url.port === expectedPort;
  } catch {
    return false;
  }
};
