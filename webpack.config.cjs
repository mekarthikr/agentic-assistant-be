const fs = require("node:fs");
const path = require("node:path");

const outputRoot = path.resolve(__dirname, ".vercel/output");
const functionDirectory = path.join(outputRoot, "functions/index.func");
const documentationSource = path.resolve(
  __dirname,
  "src/docs/enterprise-api-documentation.md",
);
const documentationOutput = path.join(
  functionDirectory,
  "src/docs/enterprise-api-documentation.md",
);

class VercelBuildOutputPlugin {
  apply(compiler) {
    compiler.hooks.afterEmit.tap("VercelBuildOutputPlugin", () => {
      fs.mkdirSync(functionDirectory, { recursive: true });
      fs.mkdirSync(path.dirname(documentationOutput), { recursive: true });
      fs.copyFileSync(documentationSource, documentationOutput);

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
  entry: path.resolve(__dirname, "vercel/entry.ts"),
  devtool: "source-map",
  externalsPresets: { node: true },
  experiments: {
    outputModule: true,
  },
  module: {
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
          },
        },
      },
    ],
  },
  resolve: {
    alias: {
      "@app": path.resolve(__dirname, "src"),
      bufferutil: false,
      "utf-8-validate": false,
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
    minimize: false,
  },
  plugins: [new VercelBuildOutputPlugin()],
};
