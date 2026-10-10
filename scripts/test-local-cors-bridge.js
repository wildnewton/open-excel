const assert = require("assert");
const http = require("http");
const {
  BRIDGE_PATH,
  DEFAULT_UPSTREAM_HEADER_TIMEOUT_MS,
  createLocalCorsBridgeMiddleware,
  parseUpstreamHeaderTimeoutMs,
} = require("./local-cors-bridge");

function listen(server, host = "127.0.0.1") {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, () => {
      server.off("error", reject);
      resolve(server.address().port);
    });
  });
}

function close(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

function requestBridge(port, targetUrl, { trusted = true, endpoint = "custom" } = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ model: "smoke-model", messages: [{ role: "user", content: "hello" }], stream: true });
    const headers = {
      Host: `127.0.0.1:${port}`,
      "X-OpenExcel-Trace-Id": "ox-test-trace",
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
    };
    if (endpoint === "gateway") {
      headers["X-OpenExcel-Gateway-Endpoint"] = "1";
    } else {
      headers["X-OpenExcel-Custom-Endpoint"] = "1";
    }
    if (trusted) {
      headers.Origin = `https://127.0.0.1:${port}`;
      headers["Sec-Fetch-Site"] = "same-origin";
    } else {
      headers.Origin = "https://example.invalid";
      headers["Sec-Fetch-Site"] = "cross-site";
    }

    const request = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: `${BRIDGE_PATH}?url=${encodeURIComponent(targetUrl)}`,
        method: "POST",
        headers,
      },
      (response) => {
        const headersReceivedAt = Date.now();
        let text = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          text += chunk;
        });
        response.on("end", () =>
          resolve({ statusCode: response.statusCode, headers: response.headers, body: text, headersReceivedAt }),
        );
      },
    );
    request.on("error", reject);
    request.end(body);
  });
}

async function main() {
  assert.equal(DEFAULT_UPSTREAM_HEADER_TIMEOUT_MS, 180000);
  assert.equal(parseUpstreamHeaderTimeoutMs(new URL("https://localhost/__openexcel_bridge")), 180000);
  assert.equal(
    parseUpstreamHeaderTimeoutMs(new URL("https://localhost/__openexcel_bridge?timeout_ms=240000")),
    240000,
  );

  let upstreamRequests = 0;
  let upstreamFirstByteSentAt = 0;
  const upstream = http.createServer((request, response) => {
    upstreamRequests += 1;
    let requestBody = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      requestBody += chunk;
    });
    request.on("end", () => {
      assert.equal(request.headers["x-openexcel-trace-id"], undefined);
      assert.equal(request.headers["x-openexcel-custom-endpoint"], undefined);
      assert.equal(request.headers["x-openexcel-gateway-endpoint"], undefined);
      const parsed = JSON.parse(requestBody);
      assert.equal(parsed.stream, true);
      assert.equal(parsed.model, "smoke-model");

      response.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      // Prove the bridge forwards response headers before the first SSE body byte.
      response.flushHeaders();
      setTimeout(() => {
        upstreamFirstByteSentAt = Date.now();
        response.write('data: {"choices":[{"index":0,"delta":{"role":"assistant","content":"Hello"}}]}\n\n');
        setTimeout(() => {
          response.write('data: {"choices":[{"index":0,"delta":{"content":" world"},"finish_reason":null}]}\n\n');
          response.end("data: [DONE]\n\n");
        }, 20);
      }, 120);
    });
  });

  const upstreamPort = await listen(upstream, "0.0.0.0");
  const middleware = createLocalCorsBridgeMiddleware();
  const bridge = http.createServer((request, response) => {
    middleware(request, response, () => {
      response.statusCode = 404;
      response.end("not found");
    });
  });
  const bridgePort = await listen(bridge);

  try {
    // 127.0.0.2 is private but not treated as the special 127.0.0.1 loopback
    // hostname by the bridge. This exercises trusted internal endpoint routing.
    const target = `http://127.0.0.2:${upstreamPort}/v1/chat/completions`;

    const rejected = await requestBridge(bridgePort, target, { trusted: false });
    assert.equal(rejected.statusCode, 403);
    assert.equal(upstreamRequests, 0, "Cross-site requests must not reach the upstream target");

    const customResult = await requestBridge(bridgePort, target, { endpoint: "custom" });
    assert.equal(customResult.statusCode, 200);
    assert.equal(customResult.headers["x-openexcel-bridge"], "local-dev");
    assert.equal(customResult.headers["x-openexcel-bridge-route"], "direct");
    assert.equal(upstreamRequests, 1);
    assert.ok(upstreamFirstByteSentAt > 0);
    assert.ok(
      customResult.headersReceivedAt < upstreamFirstByteSentAt,
      "Bridge must flush upstream response headers before the first SSE body byte",
    );
    assert.match(customResult.body, /"content":"Hello"/);
    assert.match(customResult.body, /"content":" world"/);
    assert.match(customResult.body, /data: \[DONE\]/);

    upstreamFirstByteSentAt = 0;
    const gatewayResult = await requestBridge(bridgePort, target, { endpoint: "gateway" });
    assert.equal(gatewayResult.statusCode, 200);
    assert.equal(gatewayResult.headers["x-openexcel-bridge"], "local-dev");
    assert.equal(gatewayResult.headers["x-openexcel-bridge-route"], "direct");
    assert.equal(upstreamRequests, 2, "Trusted Gateway HTTP must reach the upstream target through the bridge");
    assert.ok(upstreamFirstByteSentAt > 0);
    assert.match(gatewayResult.body, /data: \[DONE\]/);

    console.log("Local CORS bridge streaming + Gateway HTTP smoke test passed");
  } finally {
    await close(bridge);
    await close(upstream);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
