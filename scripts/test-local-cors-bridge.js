const assert = require("assert");
const http = require("http");
const { BRIDGE_PATH, createLocalCorsBridgeMiddleware } = require("./local-cors-bridge");

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

function requestBridge(port, targetUrl) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ model: "smoke-model", messages: [{ role: "user", content: "hello" }], stream: true });
    const request = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: `${BRIDGE_PATH}?url=${encodeURIComponent(targetUrl)}`,
        method: "POST",
        headers: {
          Host: `127.0.0.1:${port}`,
          Origin: `https://127.0.0.1:${port}`,
          "Sec-Fetch-Site": "same-origin",
          "X-OpenExcel-Custom-Endpoint": "1",
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (response) => {
        let text = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          text += chunk;
        });
        response.on("end", () => resolve({ statusCode: response.statusCode, headers: response.headers, body: text }));
      },
    );
    request.on("error", reject);
    request.end(body);
  });
}

async function main() {
  const upstream = http.createServer((request, response) => {
    let requestBody = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      requestBody += chunk;
    });
    request.on("end", () => {
      const parsed = JSON.parse(requestBody);
      assert.equal(parsed.stream, true);
      assert.equal(parsed.model, "smoke-model");

      response.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      response.write('data: {"choices":[{"index":0,"delta":{"role":"assistant","content":"Hello"}}]}\n\n');
      setTimeout(() => {
        response.write('data: {"choices":[{"index":0,"delta":{"content":" world"},"finish_reason":null}]}\n\n');
        response.end("data: [DONE]\n\n");
      }, 20);
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
    // hostname by the bridge. This exercises trusted Custom Endpoint routing.
    const target = `http://127.0.0.2:${upstreamPort}/v1/chat/completions`;
    const result = await requestBridge(bridgePort, target);
    assert.equal(result.statusCode, 200);
    assert.equal(result.headers["x-openexcel-bridge"], "local-dev");
    assert.equal(result.headers["x-openexcel-bridge-route"], "direct");
    assert.match(result.body, /"content":"Hello"/);
    assert.match(result.body, /"content":" world"/);
    assert.match(result.body, /data: \[DONE\]/);
    console.log("Local CORS bridge streaming smoke test passed");
  } finally {
    await close(bridge);
    await close(upstream);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
