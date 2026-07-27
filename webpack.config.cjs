const fs = require("node:fs");
const path = require("node:path");

const outputRoot = path.resolve(__dirname, ".vercel/output");
const functionDirectory = path.join(outputRoot, "functions/index.func");

class VercelBuildOutputPlugin {
  apply(compiler) {
    compiler.hooks.afterEmit.tap("VercelBuildOutputPlugin", () => {
      fs.mkdirSync(functionDirectory, { recursive: true });

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
            handler: "index.cjs",
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
  entry: path.resolve(__dirname, "src/app.ts"),
  devtool: "source-map",
  externalsPresets: { node: true },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        exclude: /node_modules/,
        use: {
          loader: "ts-loader",
          options: {
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
    filename: "index.cjs",
    clean: true,
    library: {
      type: "commonjs2",
      export: "default",
    },
  },
  optimization: {
    minimize: false,
  },
  plugins: [new VercelBuildOutputPlugin()],
};
