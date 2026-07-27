import path from "node:path";

import { EnterpriseRagService } from "../dist/service/enterprise-rag.service.js";

const documentationPath = path.resolve(
  "src/docs/enterprise-api-documentation.md",
);
const indexPath = path.resolve("src/rag/enterprise-api-index.json");

const rag = await EnterpriseRagService.load(documentationPath, indexPath);
console.log(
  `Generated enterprise RAG index with ${rag.getEndpoints().length} endpoints.`,
);
