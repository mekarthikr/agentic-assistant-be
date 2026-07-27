import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

// Vercel functions can only persist runtime-generated files under the OS temp
// directory. Set this before loading the application configuration module.
if (process.env.VERCEL) {
  process.env.ENTERPRISE_RAG_INDEX_PATH ||= path.join(
    tmpdir(),
    "enterprise-api-index.json",
  );
}

const [
  { env, groqConfiguration },
  { GroqProvider },
  { AIOrchestrator, ConversationService, EnterpriseRagService, ToolRegistry },
  { ChatSocketServer },
  { createEnterpriseTools },
  { default: app },
] = await Promise.all([
  import("@app/config"),
  import("@app/providers"),
  import("@app/service"),
  import("@app/socket"),
  import("@app/tools/enterprise-tools"),
  import("@app/app"),
]);

const httpServer = createServer(app);
const conversationService = new ConversationService();
const provider = new GroqProvider(groqConfiguration);
const enterpriseRag = await EnterpriseRagService.load(
  env.ENTERPRISE_API_DOC_PATH,
  env.ENTERPRISE_RAG_INDEX_PATH,
);
const toolRegistry = new ToolRegistry(
  createEnterpriseTools(enterpriseRag.getEndpoints()),
);
const orchestrator = new AIOrchestrator(
  conversationService,
  provider,
  toolRegistry,
  enterpriseRag,
);

new ChatSocketServer(httpServer, orchestrator);

export default httpServer;
