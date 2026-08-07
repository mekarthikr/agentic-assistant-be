import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";

const enterpriseDocumentationUrl = new URL(
  "../src/knowledge/enterprise-api-documentation.md",
  import.meta.url,
);
const documentsDirectoryUrl = new URL(
  "../src/knowledge/documents/",
  import.meta.url,
);
const navigationDirectoryUrl = new URL(
  "../src/knowledge/navigation/",
  import.meta.url,
);
const indexUrl = new URL(
  "../src/knowledge/enterprise-api-rag.json",
  import.meta.url,
);

const TOKEN_PATTERN = /[a-z0-9]+/g;
const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "can",
  "do",
  "for",
  "from",
  "get",
  "i",
  "in",
  "is",
  "me",
  "my",
  "of",
  "on",
  "please",
  "show",
  "the",
  "to",
  "what",
  "with",
]);

const normalizeToken = (token) => {
  if (token.endsWith("ies") && token.length > 4) {
    return `${token.slice(0, -3)}y`;
  }
  if (token.endsWith("s") && token.length > 3) return token.slice(0, -1);
  return token;
};

const tokenize = (value) =>
  (value.toLowerCase().match(TOKEN_PATTERN) ?? [])
    .map(normalizeToken)
    .filter((token) => !STOP_WORDS.has(token));

const sectionHeading = (content) =>
  content.match(/^#{1,3}\s+(.+)$/m)?.[1]?.trim() || "Enterprise API overview";

/** Returns all Markdown documents under a knowledge directory. */
const markdownUrls = async (directoryUrl) => {
  const entries = await readdir(directoryUrl, { withFileTypes: true });
  const urls = await Promise.all(
    entries.map(async (entry) => {
      const entryUrl = new URL(entry.name, directoryUrl);
      if (entry.isDirectory()) return markdownUrls(new URL(`${entry.name}/`, directoryUrl));
      return entry.isFile() && entry.name.endsWith(".md") ? [entryUrl] : [];
    }),
  );
  return urls.flat().sort((left, right) => left.href.localeCompare(right.href));
};

const documentUrls = [
  enterpriseDocumentationUrl,
  ...(await markdownUrls(documentsDirectoryUrl)),
  ...(await markdownUrls(navigationDirectoryUrl)),
];
const documents = await Promise.all(
  documentUrls.map(async (url) => ({
    filename: url.pathname.split("/").at(-1),
    markdown: await readFile(url, "utf8"),
    isEnterpriseReference: url.href === enterpriseDocumentationUrl.href,
  })),
);
const sections = documents.flatMap(
  ({ filename, markdown, isEnterpriseReference }) => {
    const documentTitle = sectionHeading(markdown);
    return markdown
      .split(/(?=^#{2,3}\s+)/m)
      .map((content) => content.trim())
      .filter(Boolean)
      .map((content) => {
        const heading = sectionHeading(content);
        return {
          heading: isEnterpriseReference
            ? heading
            : heading === documentTitle
              ? `${heading} (${filename})`
              : `${documentTitle} — ${heading} (${filename})`,
          content,
          headingTokens: tokenize(
            isEnterpriseReference
              ? heading
              : heading === documentTitle
                ? `${heading} ${filename}`
                : `${documentTitle} ${heading} ${filename}`,
          ),
          contentTokens: tokenize(content),
        };
      });
  },
);

const index = {
  version: 2,
  sources: documents.map(({ filename }) => filename),
  sourceHash: createHash("sha256")
    .update(documents.map(({ markdown }) => markdown).join("\n"))
    .digest("hex"),
  sections,
};

await writeFile(indexUrl, `${JSON.stringify(index, null, 2)}\n`, "utf8");
console.log(`Generated ${sections.length} RAG sections.`);
