import { cp, mkdir } from "node:fs/promises";
import { extname } from "node:path";

const sourceDirectory = new URL("../src/knowledge/", import.meta.url);
const outputDirectory = new URL("../dist/knowledge/", import.meta.url);

await mkdir(outputDirectory, { recursive: true });
await cp(sourceDirectory, outputDirectory, {
  recursive: true,
  filter: (source) => {
    const extension = extname(source);
    return extension === "" || extension === ".md" || extension === ".json";
  },
});
