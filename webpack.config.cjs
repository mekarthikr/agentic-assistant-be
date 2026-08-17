const fs = require("node:fs");
const path = require("node:path");
const webpack = require("webpack");

const outputRoot = path.resolve(__dirname, ".vercel/output");
const functionDirectory = path.join(outputRoot, "functions/index.func");

class VercelBuildOutputPlugin {
  apply(compiler) {
    compiler.hooks.afterEmit.tap("VercelBuildOutputPlugin", () => {
      fs.mkdirSync(outputRoot, { recursive: true });

      fs.writeFileSync(
        path.join(outputRoot, "config.json"),
        `${JSON.stringify(
          {
            version: 3,
            routes: [{ src: "/(.*)", dest: "/index" }],
          },
          null,
          2,
        )}\n`,
      );

      fs.writeFileSync(
        path.join(functionDirectory, ".vc-config.json"),
        `${JSON.stringify(
          {
            runtime: "nodejs22.x",
            handler: "index.mjs",
            launcherType: "Nodejs",
            shouldAddHelpers: true,
            maxDuration: 300,
          },
          null,
          2,
        )}\n`,
      );
    });
  }
}

module.exports = {
  mode: "production",
  target: "node22",
  entry: path.resolve(__dirname, "api/index.ts"),
  devtool: "source-map",
  externalsPresets: { node: true },
  experiments: {
    outputModule: true,
  },
  module: {
    // Express resolves view engines dynamically; this backend does not use views.
    exprContextCritical: false,
    rules: [
      {
        test: /\.tsx?$/,
        exclude: /node_modules/,
        use: {
          loader: "ts-loader",
          options: {
            compilerOptions: {
              rootDir: __dirname,
            },
            transpileOnly: true,
          },
        },
      },
    ],
  },
  resolve: {
    alias: {
      "@app": path.resolve(__dirname, "src"),
    },
    extensions: [".ts", ".tsx", ".js"],
  },
  output: {
    path: functionDirectory,
    filename: "index.mjs",
    clean: true,
    library: {
      type: "module",
    },
  },
  optimization: {
    // pdfjs-dist ships its own webpack runtime. Scope hoisting can concatenate
    // that runtime with ours and emit duplicate module-cache declarations.
    concatenateModules: false,
    minimize: false,
  },
  plugins: [
    // Embeddings are supplied explicitly by EmbeddingService. Chroma's optional
    // local default embedder is intentionally not installed or bundled.
    new webpack.IgnorePlugin({
      resourceRegExp: /^@chroma-core\/default-embed$/,
    }),
    new webpack.DefinePlugin({
      "process.env.WS_NO_BUFFER_UTIL": JSON.stringify("1"),
      "process.env.WS_NO_UTF_8_VALIDATE": JSON.stringify("1"),
    }),
    new VercelBuildOutputPlugin(),
  ],
};
