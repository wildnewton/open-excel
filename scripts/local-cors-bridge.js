const http = require("http");
const https = require("https");
const net = require("net");
const { execFileSync } = require("child_process");
const { HttpsProxyAgent } = require("https-proxy-agent");

const BRIDGE_PATH = "/__openexcel_bridge";
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);
const REQUEST_HEADERS_TO_DROP = new Set([
  ...HOP_BY_HOP_HEADERS,
  "host",
  "origin",
  "referer",
  "cookie",
  "sec-fetch-dest",
  "sec-fetch-mode",
  "sec-fetch-site",
]);
const RESPONSE_HEADERS_TO_DROP = new Set([...HOP_BY_HOP_HEADERS, "set-cookie"]);

function isPrivateIpv4(hostname) {
  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function isLoopbackTarget(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function isDisallowedTarget(target) {
  const hostname = target.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const loopback = isLoopbackTarget(hostname);

  // Local model servers (Ollama / LM Studio) commonly expose plain HTTP.
  // Permit HTTP only on loopback. Public targets must remain HTTPS.
  if (target.protocol === "http:") return !loopback;
  if (target.protocol !== "https:") return true;
  if (loopback) return false;
  if (hostname.endsWith(".local")) return true;
  if (net.isIPv4(hostname)) return isPrivateIpv4(hostname);
  if (net.isIPv6(hostname)) {
    return hostname.startsWith("fc") || hostname.startsWith("fd") || hostname.startsWith("fe8") || hostname.startsWith("fe9") || hostname.startsWith("fea") || hostname.startsWith("feb");
  }
  return false;
}

function parseMacSystemProxy() {
  if (process.platform !== "darwin") return null;
  try {
    const output = execFileSync("/usr/sbin/scutil", ["--proxy"], { encoding: "utf8" });
    const value = (key) => {
      const match = output.match(new RegExp(`^\\s*${key}\\s*:\\s*(.+?)\\s*$`, "m"));
      return match?.[1]?.trim() || null;
    };

    const httpsEnabled = value("HTTPSEnable") === "1";
    const httpsHost = value("HTTPSProxy");
    const httpsPort = value("HTTPSPort");
    if (httpsEnabled && httpsHost && httpsPort) return `http://${httpsHost}:${httpsPort}`;

    const httpEnabled = value("HTTPEnable") === "1";
    const httpHost = value("HTTPProxy");
    const httpPort = value("HTTPPort");
    if (httpEnabled && httpHost && httpPort) return `http://${httpHost}:${httpPort}`;
  } catch {
    // System proxy discovery is best-effort. Direct networking remains available.
  }
  return null;
}

function detectOutboundProxy() {
  const explicit = process.env.OPENEXCEL_UPSTREAM_PROXY?.trim();
  if (explicit) return { url: explicit, source: "OPENEXCEL_UPSTREAM_PROXY" };

  const system = parseMacSystemProxy();
  if (system) return { url: system, source: "macOS system proxy" };

  const envProxy = (process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy || "").trim();
  if (envProxy) return { url: envProxy, source: "proxy environment" };
  return null;
}

function copyRequestHeaders(headers) {
  const result = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || REQUEST_HEADERS_TO_DROP.has(name.toLowerCase())) continue;
    result[name] = value;
  }
  return result;
}

function copyResponseHeaders(upstream, response) {
  for (const [name, value] of Object.entries(upstream.headers)) {
    if (value === undefined || RESPONSE_HEADERS_TO_DROP.has(name.toLowerCase())) continue;
    response.setHeader(name, value);
  }
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-OpenExcel-Bridge", "local-dev");
}

function createLocalCorsBridgeMiddleware() {
  const outboundProxy = detectOutboundProxy();
  let agent;
  if (outboundProxy) {
    try {
      agent = new HttpsProxyAgent(outboundProxy.url);
      console.log(`[OpenExcel bridge] Outbound traffic will use ${outboundProxy.source}: ${outboundProxy.url.replace(/:\/\/[^@]+@/, "://***@")}`);
    } catch (error) {
      console.warn(`[OpenExcel bridge] Ignoring invalid outbound proxy: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    console.log("[OpenExcel bridge] No outbound proxy detected; using direct network access.");
  }

  return (request, response, next) => {
    let requestUrl;
    try {
      requestUrl = new URL(request.url, "https://localhost");
    } catch {
      return next();
    }

    if (requestUrl.pathname !== BRIDGE_PATH) return next();

    const rawTarget = requestUrl.searchParams.get("url");
    if (!rawTarget) {
      response.statusCode = 400;
      response.end("Missing url query parameter");
      return;
    }

    let target;
    try {
      target = new URL(rawTarget);
    } catch {
      response.statusCode = 400;
      response.end("Invalid target URL");
      return;
    }

    if (isDisallowedTarget(target)) {
      response.statusCode = 403;
      response.end("Local CORS bridge only allows public HTTPS targets");
      return;
    }

    const method = (request.method || "GET").toUpperCase();
    if (!["GET", "POST", "HEAD"].includes(method)) {
      response.statusCode = 405;
      response.end("Method not allowed");
      return;
    }

    const loopback = isLoopbackTarget(target.hostname.toLowerCase().replace(/^\[|\]$/g, ""));
    const transport = target.protocol === "http:" ? http : https;
    const upstreamRequest = transport.request(
      target,
      {
        method,
        headers: copyRequestHeaders(request.headers),
        // Local endpoints should never be sent through the machine's outbound proxy.
        agent: loopback ? undefined : agent,
      },
      (upstreamResponse) => {
        response.statusCode = upstreamResponse.statusCode || 502;
        if (upstreamResponse.statusMessage) response.statusMessage = upstreamResponse.statusMessage;
        copyResponseHeaders(upstreamResponse, response);
        upstreamResponse.pipe(response);
      },
    );

    upstreamRequest.on("error", (error) => {
      if (!response.headersSent) {
        response.statusCode = 502;
        response.setHeader("Content-Type", "text/plain; charset=utf-8");
      }
      response.end(`OpenExcel local bridge failed: ${error instanceof Error ? error.message : String(error)}`);
    });

    request.pipe(upstreamRequest);
  };
}

module.exports = { BRIDGE_PATH, createLocalCorsBridgeMiddleware };
