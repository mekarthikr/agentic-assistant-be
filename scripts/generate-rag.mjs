import { writeFile } from "node:fs/promises";

import { buildKnowledgeIndex } from "../src/knowledge/rag-documents.mjs";

const knowledgeDirectoryUrl = new URL("../src/knowledge/", import.meta.url);
const indexUrl = new URL("enterprise-api-rag.json", knowledgeDirectoryUrl);
const index = await buildKnowledgeIndex({ knowledgeDirectoryUrl });

await writeFile(indexUrl, `${JSON.stringify(index, null, 2)}\n`, "utf8");
console.log(`Generated ${index.sections.length} LangChain RAG sections.`);
