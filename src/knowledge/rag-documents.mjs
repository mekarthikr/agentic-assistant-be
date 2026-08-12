import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { extname } from "node:path";

import { Document } from "@langchain/core/documents";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { PDFParse } from "pdf-parse";

const CHUNK_SIZE = 2_400;
const CHUNK_OVERLAP = 240;
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

const splitter = new RecursiveCharacterTextSplitter({
  chunkSize: CHUNK_SIZE,
  chunkOverlap: CHUNK_OVERLAP,
  separators: ["\n## ", "\n### ", "\n\n", "\n", ". ", " "],
});

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

const humanizeFilename = (filename) => {
  const minorWords = new Set(["a", "an", "and", "of", "the", "to"]);
  return filename
    .replace(/\.[^.]+$/, "")
    .replaceAll("-", " ")
    .split(" ")
    .map((word, index) =>
      index > 0 && minorWords.has(word)
        ? word
        : `${word.charAt(0).toUpperCase()}${word.slice(1)}`,
    )
    .join(" ");
};

const knowledgeDocumentUrls = async (directoryUrl, extensions) => {
  const entries = await readdir(directoryUrl, { withFileTypes: true });
  const urls = await Promise.all(
    entries.map(async (entry) => {
      const entryUrl = new URL(entry.name, directoryUrl);
      if (entry.isDirectory()) {
        return knowledgeDocumentUrls(
          new URL(`${entry.name}/`, directoryUrl),
          extensions,
        );
      }
      return entry.isFile() && extensions.has(extname(entry.name).toLowerCase())
        ? [entryUrl]
        : [];
    }),
  );
  return urls.flat().sort((left, right) => left.href.localeCompare(right.href));
};

const loadLangChainDocuments = async (
  url,
  isEnterpriseReference,
  isNavigationReference,
) => {
  const filename = decodeURIComponent(url.pathname.split("/").at(-1));
  const source = await readFile(url);
  const mediaType =
    extname(filename).toLowerCase() === ".pdf"
      ? "application/pdf"
      : "text/markdown";

  if (mediaType !== "application/pdf") {
    return {
      filename,
      source,
      documents: [
        new Document({
          pageContent: source.toString("utf8"),
          metadata: {
            filename,
            mediaType,
            isEnterpriseReference,
            isNavigationReference,
          },
        }),
      ],
    };
  }

  const parser = new PDFParse({ data: source });
  try {
    const result = await parser.getText({ pageJoiner: "" });
    const title = humanizeFilename(filename);
    return {
      filename,
      source,
      documents: result.pages.map(
        ({ num, text }) =>
          new Document({
            pageContent: `# ${title}\n\n${text.trim()}`,
            metadata: {
              filename,
              mediaType,
              page: num,
              isEnterpriseReference,
              isNavigationReference,
            },
          }),
      ),
    };
  } finally {
    await parser.destroy();
  }
};

const splitDocumentSections = async (document) => {
  const documentTitle = sectionHeading(document.pageContent);
  const isContentsPage =
    /\bTable of Contents\b/i.test(document.pageContent) &&
    document.pageContent.length > 4_000;
  const structuralSections = document.pageContent
    .split(/(?=^#{2,3}\s+)/m)
    .map((content) => content.trim())
    .filter(Boolean);
  const chunks = [];

  for (const content of structuralSections) {
    const heading = sectionHeading(content);
    const splitChunks = await splitter.splitDocuments([
      new Document({
        pageContent: content,
        metadata: { ...document.metadata, documentTitle, heading },
      }),
    ]);
    splitChunks.forEach((chunk) => {
      chunks.push({
        ...chunk,
        metadata: { ...chunk.metadata, isContentsPage },
      });
    });
  }

  return chunks;
};

const resolveKnowledgeDirectoryUrl = async (configuredUrl) => {
  if (configuredUrl) return configuredUrl;

  const candidates = [
    new URL("./", import.meta.url),
    new URL("./knowledge/", import.meta.url),
  ];
  for (const candidate of candidates) {
    try {
      await readFile(new URL("enterprise-api-documentation.md", candidate));
      return candidate;
    } catch {
      // Try the next supported source/build/serverless layout.
    }
  }
  throw new Error("The packaged knowledge documents could not be located.");
};

export const buildKnowledgeIndex = async ({ knowledgeDirectoryUrl } = {}) => {
  knowledgeDirectoryUrl = await resolveKnowledgeDirectoryUrl(
    knowledgeDirectoryUrl,
  );
  const enterpriseDocumentationUrl = new URL(
    "enterprise-api-documentation.md",
    knowledgeDirectoryUrl,
  );
  const documentsDirectoryUrl = new URL("documents/", knowledgeDirectoryUrl);
  const navigationDirectoryUrl = new URL("navigation/", knowledgeDirectoryUrl);
  const documentUrls = [
    enterpriseDocumentationUrl,
    ...(await knowledgeDocumentUrls(
      documentsDirectoryUrl,
      new Set([".md", ".pdf"]),
    )),
    ...(await knowledgeDocumentUrls(navigationDirectoryUrl, new Set([".md"]))),
  ];
  const loadedDocuments = await Promise.all(
    documentUrls.map((url) =>
      loadLangChainDocuments(
        url,
        url.href === enterpriseDocumentationUrl.href,
        url.href.startsWith(navigationDirectoryUrl.href),
      ),
    ),
  );
  const langChainChunks = (
    await Promise.all(
      loadedDocuments
        .flatMap(({ documents }) => documents)
        .map(splitDocumentSections),
    )
  ).flat();

  const chunkPositions = new Map();
  const sections = langChainChunks.map(({ pageContent, metadata }) => {
    const filename = String(metadata.filename);
    const documentTitle = String(metadata.documentTitle);
    const heading = String(metadata.heading);
    const isEnterpriseReference = metadata.isEnterpriseReference === true;
    const ragEligible =
      !isEnterpriseReference && metadata.isNavigationReference !== true;
    const page = Number(metadata.page) > 0 ? Number(metadata.page) : 0;
    const positionKey = `${filename}:${page}`;
    const chunkIndex = chunkPositions.get(positionKey) ?? 0;
    chunkPositions.set(positionKey, chunkIndex + 1);
    const displayHeading = isEnterpriseReference
      ? heading
      : heading === documentTitle
        ? `${heading} (${filename})`
        : `${documentTitle} — ${heading} (${filename})`;

    return {
      heading: displayHeading,
      content: pageContent,
      source: {
        filename,
        title: documentTitle,
        mediaType: String(metadata.mediaType),
        ...(page > 0 ? { page } : {}),
        chunkIndex,
        ...(metadata.isContentsPage === true ? { isContentsPage: true } : {}),
        ragEligible,
      },
      headingTokens: tokenize(displayHeading),
      contentTokens: tokenize(pageContent),
    };
  });

  return {
    version: 4,
    sources: loadedDocuments.map(({ filename }) => filename),
    sourceHash: createHash("sha256")
      .update(Buffer.concat(loadedDocuments.map(({ source }) => source)))
      .digest("hex"),
    sections,
  };
};
