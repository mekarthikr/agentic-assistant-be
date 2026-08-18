import { extname } from "node:path";

import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";

import type { ParsedDocumentSection } from "@app/types";

const SUPPORTED_EXTENSIONS = new Set([".pdf", ".docx", ".txt", ".md"]);
const normalize = (text: string): string =>
  text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();

const sectionsFromPlainText = (text: string): ParsedDocumentSection[] => {
  const paragraphs = normalize(text)
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean);
  let currentSection: string | undefined;

  return paragraphs.flatMap((content) => {
    const isHeading =
      content.length <= 100 &&
      (content.endsWith(":") ||
        /^[A-Z][A-Z\d &/()-]+$/.test(content) ||
        /^#{1,6}\s+/.test(content));
    if (isHeading) {
      currentSection = content.replace(/^#{1,6}\s+/, "").replace(/:$/, "");
      return [];
    }
    return [
      { content, ...(currentSection ? { section: currentSection } : {}) },
    ];
  });
};

/** Extracts supported uploads while retaining page/section boundaries. */
export class DocumentParserService {
  public async parse(input: {
    name: string;
    buffer: Buffer;
  }): Promise<ParsedDocumentSection[]> {
    const extension = extname(input.name).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(extension)) {
      throw new Error(
        "Unsupported document type. Upload a PDF, DOCX, TXT, or MD file.",
      );
    }

    let sections: ParsedDocumentSection[];
    if (extension === ".pdf") {
      const parser = new PDFParse({ data: input.buffer });
      try {
        const result = await parser.getText();
        sections = result.pages.flatMap(({ num, text }) =>
          sectionsFromPlainText(text).map((section) => ({
            ...section,
            page: num,
          })),
        );
      } finally {
        await parser.destroy();
      }
    } else if (extension === ".docx") {
      const result = await mammoth.extractRawText({ buffer: input.buffer });
      sections = sectionsFromPlainText(result.value);
    } else {
      sections = sectionsFromPlainText(input.buffer.toString("utf8"));
    }

    if (!sections.some(({ content }) => content.trim())) {
      throw new Error("The uploaded document contains no extractable text.");
    }
    return sections;
  }
}

export const isSupportedDocumentName = (name: string): boolean =>
  SUPPORTED_EXTENSIONS.has(extname(name).toLowerCase());
