# Agentic Assistant backend

Express and native WebSocket (`ws`) backend for Agentic Assistant.

## Setup

```bash
npm install
copy .env.example .env
npm run dev
```

The HTTP health check is available at `GET /health`. WebSocket chat uses
`ws://localhost:5000/ws` by default.

## Deploy to Vercel

The production build uses webpack to bundle the Vercel Function and resolve
the `@app` TypeScript alias. Import this repository in Vercel, keep the project
root at the repository root, and configure:

- `GROQ_API_KEY` (required)
- `GROQ_MODEL` (optional)
- `ENTERPRISE_API_BASE_URL` (optional)

Vercel runs `npm run build` and serves the generated Build Output API artifact
from `.vercel/output`. Verify the deployment with `GET /health`.

The local server continues to provide WebSocket chat at `/ws`. Vercel Functions
do not provide a persistent WebSocket server, so deploy the WebSocket transport
to a long-running Node.js host or replace it with a Vercel-compatible realtime
service before using chat in production.

## Enterprise tools

The assistant can use the documented Contracts and Applications APIs through
four Groq tools: `searchContracts`, `getContract`, `searchApplications`, and
`getApplication`. Tool schemas and implementations are in
`src/tools/enterprise-tools.ts`.

## Insurance knowledge and scope

The enterprise API reference is stored at
`src/knowledge/enterprise-api-documentation.md`. At chat time, the backend
ranks its sections against the recent conversation and adds the most relevant
sections to the model's system context. Run `npm run rag:generate` after
changing the reference. The production build regenerates the deterministic
RAG index automatically and copies both knowledge artifacts into
`dist/knowledge`.

The permanent system prompt in `src/knowledge/insurance-agent.prompt.ts`
defines the assistant as a copilot for insurance agents. It permits insurance
and closely related agent workflows, allows brief greetings, and directs the
assistant to decline unrelated requests.

### HTTPS certificate setup

If Node reports `UNABLE_TO_GET_ISSUER_CERT_LOCALLY` when calling the enterprise
API, configure Node to trust your organization's root CA certificate before
starting the backend:

```powershell
$env:NODE_EXTRA_CA_CERTS = "C:\path\to\organization-root-ca.pem"
npm run dev
```

Obtain this certificate from your IT team. Do not disable TLS certificate
validation in application code.

## Configuration

- `PORT`: HTTP and WebSocket port; defaults to `5000`.
- `CORS_ORIGIN`: comma-separated allowed browser origins. Required in
  production.
- `WS_PATH`: WebSocket upgrade path; defaults to `/ws`.
- `SOCKET_AUTH_TOKEN`: required in production. When configured, the first
  client frame must be `{"type":"auth","token":"..."}`.

HTTP CORS and WebSocket `Origin` validation use the same origin allowlist.

## WebSocket protocol

Send a chat request:

```json
{
  "type": "chat.send",
  "requestId": "request-123",
  "conversationId": "conversation-123",
  "message": "Hi"
}
```

The server emits `connection.ready`, `chat.started`, one or more `chat.delta`
messages, then `chat.complete`. Failures use `chat.error`. A running request
can be cancelled with:

```json
{ "type": "chat.cancel", "requestId": "request-123" }
```

The included backend mock returns `Hello! How can I help you today?` for a
greeting and provides deterministic placeholders for contract, approval, and
product questions. Replace `mockChatHandler` in `src/socket/chat-socket.ts`
with the production AI agent handler when it is ready.

## Production safeguards

The server includes graceful shutdown, WebSocket heartbeats, authentication,
origin checks, JSON validation, message and payload limits, request
cancellation, and per-connection rate limiting.

## AI SDK tools

Tool calling follows a ports-and-adapters boundary:

```
AIOrchestrator -> ToolRegistry -> application tool implementations
       |                 |
       v                 v
 LLMProvider        AI SDK tool schemas -> GroqProvider
```

`GroqProvider` receives only declarative AI SDK schemas. It returns structured
tool calls; `AIOrchestrator` executes them through the injected `ToolRegistry`,
appends AI SDK assistant/tool-result messages, and asks the model to continue.
The loop is bounded to eight tool rounds by default (`ChatOptions.maxToolRounds`).

Register concrete tools in the composition root (`src/server.ts`) and inject
their dependencies normally. For example:

```ts
import { jsonSchema } from "ai";
import { ToolRegistry, type ApplicationTool } from "@app/service";

const accountLookup: ApplicationTool = {
  name: "lookupAccount",
  description: "Looks up an account by its identifier.",
  inputSchema: jsonSchema({
    type: "object",
    properties: { accountId: { type: "string" } },
    required: ["accountId"],
    additionalProperties: false,
  }),
  async execute(input, { signal }) {
    signal?.throwIfAborted();
    return accountService.lookup((input as { accountId: string }).accountId);
  },
};

const toolRegistry = new ToolRegistry([accountLookup]);
```

Keep authorization, input validation, and side-effect policy inside each
application tool. Tool failures are returned to the model as tool-result
errors so it can recover or explain the failure.

## Scripts

- `npm run dev` starts the TypeScript server in watch mode.
- `npm run rag:generate` rebuilds the enterprise API RAG index.
- `npm run build` creates the `dist` build.
- `npm start` runs the production build.
- `npm run lint` checks the source.
