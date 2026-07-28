import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const documentationUrl = new URL(
  "../src/knowledge/enterprise-api-documentation.md",
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
  content.match(/^#{1,3}\s+(.+)$/m)?.[1]?.trim() ||
  "Enterprise API overview";

const markdown = await readFile(documentationUrl, "utf8");
const sections = markdown
  .split(/(?=^#{2,3}\s+)/m)
  .map((content) => content.trim())
  .filter(Boolean)
  .map((content) => {
    const heading = sectionHeading(content);
    return {
      heading,
      content,
      headingTokens: tokenize(heading),
      contentTokens: tokenize(content),
    };
  });

const index = {
  version: 1,
  source: "enterprise-api-documentation.md",
  sourceHash: createHash("sha256").update(markdown).digest("hex"),
  sections,
};

await writeFile(indexUrl, `${JSON.stringify(index, null, 2)}\n`, "utf8");
console.log(`Generated ${sections.length} RAG sections.`);
