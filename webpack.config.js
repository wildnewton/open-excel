/* eslint-disable no-undef */

const devCerts = require("office-addin-dev-certs");
const CopyWebpackPlugin = require("copy-webpack-plugin");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const webpack = require("webpack");
const path = require("path");

const urlDev = "https://localhost:3000/";
const urlProd = "https://www.contoso.com/"; // CHANGE THIS TO YOUR PRODUCTION DEPLOYMENT LOCATION

async function getHttpsOptions() {
  const httpsOptions = await devCerts.getHttpsServerOptions();
  return { ca: httpsOptions.ca, key: httpsOptions.key, cert: httpsOptions.cert };
}

module.exports = async (env, options) => {
  const dev = options.mode === "development";
  const config = {
    devtool: "source-map",
    entry: {
      polyfill: ["core-js/stable", "regenerator-runtime/runtime"],
      react: ["react", "react-dom"],
      taskpane: {
        import: ["./src/taskpane/index.tsx", "./src/taskpane/taskpane.html"],
        dependOn: "react",
      },
      commands: "./src/commands/commands.ts",
    },
    output: {
      clean: true,
    },
    resolve: {
      extensions: [".ts", ".tsx", ".html", ".js", ".mjs"],
      fallback: {
        buffer: require.resolve("buffer/"),
        stream: require.resolve("stream-browserify"),
        util: require.resolve("util/"),
        url: require.resolve("url/"),
        http: require.resolve("stream-http"),
        https: require.resolve("https-browserify"),
        zlib: require.resolve("browserify-zlib"),
        path: require.resolve("path-browserify"),
        os: require.resolve("os-browserify/browser"),
        assert: require.resolve("assert/"),
        events: require.resolve("events/"),
        querystring: require.resolve("querystring-es3"),
        punycode: require.resolve("punycode/"),
        string_decoder: require.resolve("string_decoder/"),
        constants: require.resolve("constants-browserify"),
        vm: require.resolve("vm-browserify"),
        process: require.resolve("process/browser"),
        crypto: require.resolve("./src/shims/crypto-shim.js"),
        fs: false,
        net: false,
        tls: false,
        dns: false,
        child_process: false,
        http2: false,
        worker_threads: false,
        async_hooks: false,
        perf_hooks: false,
      },
      alias: {
        "node:buffer": require.resolve("buffer/"),
        "node:stream": require.resolve("stream-browserify"),
        "node:util": require.resolve("util/"),
        "node:url": require.resolve("url/"),
        "node:http": require.resolve("stream-http"),
        "node:https": require.resolve("https-browserify"),
        "node:zlib": require.resolve("browserify-zlib"),
        "node:path": require.resolve("path-browserify"),
        "node:os": require.resolve("os-browserify/browser"),
        "node:assert": require.resolve("assert/"),
        "node:events": require.resolve("events/"),
        "node:querystring": require.resolve("querystring-es3"),
        "node:punycode": require.resolve("punycode/"),
        "node:string_decoder": require.resolve("string_decoder/"),
        "node:constants": require.resolve("constants-browserify"),
        "node:vm": require.resolve("vm-browserify"),
        "node:process": require.resolve("process/browser"),
        "node:crypto": require.resolve("./src/shims/crypto-shim.js"),
        "node:fs": false,
        "node:net": false,
        "node:tls": false,
        "node:dns": false,
        "node:child_process": false,
        "node:http2": false,
        "node:worker_threads": false,
        "node:async_hooks": false,
        "node:perf_hooks": false,
      },
    },
    module: {
      rules: [
        {
          test: /\.ts$/,
          exclude: /node_modules/,
          use: {
            loader: "babel-loader",
          },
        },
        {
          test: /\.tsx?$/,
          exclude: /node_modules/,
          use: ["ts-loader"],
        },
        {
          test: /\.html$/,
          exclude: /node_modules/,
          use: "html-loader",
        },
        {
          test: /\.css$/,
          use: ["style-loader", "css-loader", "postcss-loader"],
        },
        {
          test: /\.(png|jpg|jpeg|ttf|woff|woff2|gif|ico)$/,
          type: "asset/resource",
          generator: {
            filename: "assets/[name][ext][query]",
          },
        },
      ],
    },
    plugins: [
      new HtmlWebpackPlugin({
        filename: "taskpane.html",
        template: "./src/taskpane/taskpane.html",
        chunks: ["polyfill", "taskpane", "react"],
      }),
      new CopyWebpackPlugin({
        patterns: [
          {
            from: "assets/*",
            to: "assets/[name][ext][query]",
          },
          {
            from: "manifest*.xml",
            to: "[name]" + "[ext]",
            transform(content) {
              if (dev) {
                return content;
              } else {
                return content.toString().replace(new RegExp(urlDev, "g"), urlProd);
              }
            },
          },
        ],
      }),
      new HtmlWebpackPlugin({
        filename: "commands.html",
        template: "./src/commands/commands.html",
        chunks: ["polyfill", "commands"],
      }),
      new webpack.ProvidePlugin({
        Promise: ["es6-promise", "Promise"],
        Buffer: ["buffer", "Buffer"],
      }),
      new webpack.DefinePlugin({
        "process.env": JSON.stringify({}),
        "process.versions": "undefined",
        "process.browser": JSON.stringify(true),
        __APP_VERSION__: JSON.stringify(require("./package.json").version),
      }),
    ],
    devServer: {
      hot: true,
      headers: {
        "Access-Control-Allow-Origin": "*",
      },
      server: {
        type: "https",
        options:
          env.WEBPACK_BUILD || options.https !== undefined
            ? options.https
            : await getHttpsOptions(),
      },
      port: process.env.npm_package_config_dev_server_port || 3000,
    },
  };

  return config;
};
