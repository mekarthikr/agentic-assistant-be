import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { flowTracer } from "@app/observability";

// Vercel functions can only persist runtime-generated files under the OS temp
// directory. Set this before loading the application configuration module.
if (process.env.VERCEL) {
  process.env.ENTERPRISE_RAG_INDEX_PATH ||= path.join(
    tmpdir(),
    "enterprise-api-index.json",
  );
}

const finishBootstrap = flowTracer.start({
  stage: "system",
  action: "backend.bootstrap.started",
  summary: "Vercel backend dependency initialization started.",
  context: { traceId: "backend-bootstrap", transport: "system" },
});
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
finishBootstrap({
  level: "success",
  action: "backend.bootstrap.completed",
  summary: "The Vercel HTTP and WebSocket server is ready.",
  details: {
    websocketPath: env.WS_PATH,
    model: env.GROQ_MODEL,
    enterpriseToolCount: enterpriseRag.getEndpoints().length,
  },
});

export default httpServer;
