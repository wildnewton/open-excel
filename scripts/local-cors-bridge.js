const http = require("http");
const https = require("https");
const net = require("net");
const dns = require("dns");
const { execFileSync } = require("child_process");
const { HttpsProxyAgent } = require("https-proxy-agent");

const BRIDGE_PATH = "/__openexcel_bridge";
const CUSTOM_ENDPOINT_HEADER = "x-openexcel-custom-endpoint";
const DNS_CLASSIFICATION_TIMEOUT_MS = 2000;
const DEFAULT_UPSTREAM_HEADER_TIMEOUT_MS = 180000;
const MIN_UPSTREAM_HEADER_TIMEOUT_MS = 1000;
const MAX_UPSTREAM_HEADER_TIMEOUT_MS = 3600000;
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
  CUSTOM_ENDPOINT_HEADER,
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

function isPrivateIpv6(hostname) {
  const value = hostname.toLowerCase();
  return (
    value === "::1" ||
    value.startsWith("fc") ||
    value.startsWith("fd") ||
    value.startsWith("fe8") ||
    value.startsWith("fe9") ||
    value.startsWith("fea") ||
    value.startsWith("feb")
  );
}

function isLoopbackTarget(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function isPrivateAddress(address) {
  return net.isIPv4(address) ? isPrivateIpv4(address) : net.isIPv6(address) ? isPrivateIpv6(address) : false;
}

async function resolvesToPrivateNetwork(hostname) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (isLoopbackTarget(normalized) || normalized.endsWith(".local")) return true;
  if (net.isIP(normalized)) return isPrivateAddress(normalized);

  try {
    const lookup = dns.promises.lookup(normalized, { all: true }).then((addresses) =>
      addresses.some(({ address }) => isPrivateAddress(address)),
    );
    const timeout = new Promise((resolve) => {
      setTimeout(() => resolve(false), DNS_CLASSIFICATION_TIMEOUT_MS);
    });
    return await Promise.race([lookup, timeout]);
  } catch {
    return false;
  }
}

function isTrustedCustomEndpointRequest(request) {
  if (request.headers[CUSTOM_ENDPOINT_HEADER] !== "1") return false;
  const host = String(request.headers.host || "").toLowerCase();
  if (!(host.startsWith("localhost:") || host.startsWith("127.0.0.1:") || host === "localhost" || host === "127.0.0.1")) {
    return false;
  }

  // Sec-Fetch-Site is browser-controlled and cannot be forged by page JS.
  if (request.headers["sec-fetch-site"] === "same-origin") return true;

  const expectedOrigin = `https://${host}`;
  if (request.headers.origin === expectedOrigin) return true;
  const referer = String(request.headers.referer || "");
  return referer.startsWith(`${expectedOrigin}/`);
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

function copyResponseHeaders(upstream, response, route) {
  for (const [name, value] of Object.entries(upstream.headers)) {
    if (value === undefined || RESPONSE_HEADERS_TO_DROP.has(name.toLowerCase())) continue;
    response.setHeader(name, value);
  }
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-OpenExcel-Bridge", "local-dev");
  response.setHeader("X-OpenExcel-Bridge-Route", route);
}

function createRequestId() {
  return Math.random().toString(36).slice(2, 8);
}

function parseUpstreamHeaderTimeoutMs(requestUrl) {
  const raw = Number.parseInt(requestUrl.searchParams.get("timeout_ms") || "", 10);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_UPSTREAM_HEADER_TIMEOUT_MS;
  return Math.min(MAX_UPSTREAM_HEADER_TIMEOUT_MS, Math.max(MIN_UPSTREAM_HEADER_TIMEOUT_MS, raw));
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
    const handle = async () => {
      let requestUrl;
      try {
        requestUrl = new URL(request.url, "https://localhost");
      } catch {
        return next();
      }

      if (requestUrl.pathname !== BRIDGE_PATH) return next();

      const upstreamHeaderTimeoutMs = parseUpstreamHeaderTimeoutMs(requestUrl);
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

      if (target.protocol !== "http:" && target.protocol !== "https:") {
        response.statusCode = 403;
        response.end("Local CORS bridge only supports HTTP(S) targets");
        return;
      }

      const trustedCustomEndpoint = isTrustedCustomEndpointRequest(request);
      const normalizedHostname = target.hostname.toLowerCase().replace(/^\[|\]$/g, "");
      const loopback = isLoopbackTarget(normalizedHostname);

      // A trusted plain-HTTP Custom Endpoint is always sent directly. Do not do a
      // preflight DNS classification first: that extra resolver call is unnecessary
      // for routing and can leave the browser request pending when local DNS is slow.
      let privateNetwork = loopback;
      if (!(trustedCustomEndpoint && target.protocol === "http:") && !loopback) {
        privateNetwork = await resolvesToPrivateNetwork(target.hostname);
      }

      // Generic provider proxying stays locked to public HTTPS (plus historical
      // loopback support). Private/LAN or plain HTTP is permitted only when the
      // request is explicitly marked as a Custom Endpoint request from this
      // same-origin taskpane.
      if (!trustedCustomEndpoint) {
        if (target.protocol === "http:" && !loopback) {
          response.statusCode = 403;
          response.end("Plain HTTP targets are only allowed for trusted Custom Endpoints");
          return;
        }
        if (privateNetwork && !loopback) {
          response.statusCode = 403;
          response.end("Private-network targets are only allowed for trusted Custom Endpoints");
          return;
        }
      }

      const method = (request.method || "GET").toUpperCase();
      if (!["GET", "POST", "HEAD"].includes(method)) {
        response.statusCode = 405;
        response.end("Method not allowed");
        return;
      }

      // Internal/private Custom Endpoints must bypass Clash/system proxy. Plain
      // HTTP Custom Endpoints are also direct because HttpsProxyAgent is not the
      // right transport for them. Public HTTPS keeps the existing proxy behavior.
      const direct = loopback || (trustedCustomEndpoint && (privateNetwork || target.protocol === "http:"));
      const route = direct || !agent ? "direct" : "system-proxy";
      const transport = target.protocol === "http:" ? http : https;
      const requestId = createRequestId();
      const startedAt = Date.now();

      console.log(
        `[OpenExcel bridge:${requestId}] start method=${method} protocol=${target.protocol.slice(0, -1)} custom=${trustedCustomEndpoint ? "yes" : "no"} route=${route} responseStartTimeout=${upstreamHeaderTimeoutMs}ms`,
      );

      let headerTimer;
      const upstreamRequest = transport.request(
        target,
        {
          method,
          headers: copyRequestHeaders(request.headers),
          agent: direct ? undefined : agent,
        },
        (upstreamResponse) => {
          if (headerTimer) clearTimeout(headerTimer);
          console.log(
            `[OpenExcel bridge:${requestId}] headers status=${upstreamResponse.statusCode || 502} after=${Date.now() - startedAt}ms`,
          );
          response.statusCode = upstreamResponse.statusCode || 502;
          if (upstreamResponse.statusMessage) response.statusMessage = upstreamResponse.statusMessage;
          copyResponseHeaders(upstreamResponse, response, route);

          upstreamResponse.on("error", (error) => {
            console.warn(
              `[OpenExcel bridge:${requestId}] upstream response error after=${Date.now() - startedAt}ms: ${error instanceof Error ? error.message : String(error)}`,
            );
            if (!response.destroyed) response.destroy(error);
          });
          upstreamResponse.on("aborted", () => {
            console.warn(`[OpenExcel bridge:${requestId}] upstream response aborted after=${Date.now() - startedAt}ms`);
            if (!response.destroyed) response.destroy();
          });
          upstreamResponse.pipe(response);
        },
      );

      headerTimer = setTimeout(() => {
        const timeoutError = new Error(`Timed out waiting for upstream response headers after ${upstreamHeaderTimeoutMs}ms`);
        timeoutError.code = "OPENEXCEL_UPSTREAM_HEADER_TIMEOUT";
        upstreamRequest.destroy(timeoutError);
      }, upstreamHeaderTimeoutMs);

      upstreamRequest.on("error", (error) => {
        if (headerTimer) clearTimeout(headerTimer);
        console.warn(
          `[OpenExcel bridge:${requestId}] request failed after=${Date.now() - startedAt}ms: ${error instanceof Error ? error.message : String(error)}`,
        );
        if (response.headersSent) {
          if (!response.destroyed) response.destroy(error);
          return;
        }
        response.statusCode = error?.code === "OPENEXCEL_UPSTREAM_HEADER_TIMEOUT" ? 504 : 502;
        response.setHeader("Content-Type", "text/plain; charset=utf-8");
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("X-OpenExcel-Bridge", "local-dev");
        response.setHeader("X-OpenExcel-Bridge-Route", route);
        response.end(`OpenExcel local bridge failed: ${error instanceof Error ? error.message : String(error)}`);
      });

      request.on("aborted", () => {
        if (headerTimer) clearTimeout(headerTimer);
        upstreamRequest.destroy();
      });
      response.on("close", () => {
        if (!response.writableEnded) {
          if (headerTimer) clearTimeout(headerTimer);
          upstreamRequest.destroy();
        }
      });

      request.pipe(upstreamRequest);
    };

    handle().catch((error) => {
      if (!response.headersSent) {
        response.statusCode = 500;
        response.setHeader("Content-Type", "text/plain; charset=utf-8");
      }
      response.end(`OpenExcel local bridge error: ${error instanceof Error ? error.message : String(error)}`);
    });
  };
}

module.exports = {
  BRIDGE_PATH,
  DEFAULT_UPSTREAM_HEADER_TIMEOUT_MS,
  createLocalCorsBridgeMiddleware,
  parseUpstreamHeaderTimeoutMs,
  isPrivateIpv4,
  isPrivateIpv6,
  isTrustedCustomEndpointRequest,
};
