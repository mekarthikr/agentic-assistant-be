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

## Uploaded-document RAG

The chatbot accepts PDF, DOCX, and TXT files at `POST /documents` as a
`multipart/form-data` field named `document`. `GET /documents` lists the
authenticated user's documents, `PUT /documents/:documentId` re-indexes one,
and `DELETE /documents/:documentId` removes both its metadata and Chroma
vectors. When `SOCKET_AUTH_TOKEN` is configured, HTTP requests use the same
value as a Bearer token.

Run a Chroma server on the configured host and port before uploading files.
The `documents` collection is created automatically with cosine distance.
Chunks are embedded once through Vercel AI Gateway using the configured
`RAG_EMBEDDING_MODEL` (default `openai/text-embedding-3-small`). Questions use
the same model and do not re-embed stored chunks. Local development requires
`AI_GATEWAY_API_KEY`; Vercel deployments may use the platform's Gateway
authentication.

Document lifecycle state is stored in the SQLite database configured by
`RAG_DATABASE_PATH`. The default local path is `.data/documents.sqlite`; the
default on Vercel is `/tmp`, which is ephemeral. Production deployments should
mount durable storage or replace `DocumentRepository` with the application's
durable database adapter. Chroma itself must also be a persistent external
service.

The current application has one shared-token identity, so
`RAG_DEFAULT_USER_ID` is the trusted user mapped to that verified token. For a
multi-user deployment, replace the auth middleware/socket identity mapping
with the real session subject; never accept a user ID directly from the
browser.

## Deploy to Vercel

The production build uses webpack to bundle the Vercel Function and resolve
the `@app` TypeScript alias. Import this repository in Vercel, keep the project
root at the repository root, and configure:

- `GROQ_API_KEY` (required)
- `GROQ_MODEL` (optional; defaults to `openai/gpt-oss-20b`)
- `ENTERPRISE_API_BASE_URL` (optional)

Vercel runs `npm run build` and serves the generated Build Output API artifact
from `.vercel/output`. Verify the deployment with `GET /health`.

The local server provides WebSocket chat at `/ws` through Node's native upgrade
event. On Vercel, the same endpoint uses the Vercel Functions WebSocket upgrade
bridge. Enable Fluid Compute for the project and use Vercel CLI 54.14.2 or
later. Connections are bounded by the Function's maximum duration, so clients
must reconnect with backoff when a connection closes.

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
- `RAG_DEFAULT_USER_ID`: server-owned user identity mapped to the verified
  application token.
- `CHROMA_HOST`, `CHROMA_PORT`, `CHROMA_SSL`: Chroma connection settings.
- `CHROMA_COLLECTION`: collection name; defaults to `documents`.
- `CHROMA_TENANT`, `CHROMA_DATABASE`: optional Chroma tenant/database scope.
- `RAG_TOP_K`: maximum retrieved chunks; defaults to `5`.
- `RAG_EMBEDDING_MODEL`: AI Gateway embedding model; defaults to
  `openai/text-embedding-3-small`.
- `RAG_RELEVANCE_THRESHOLD`: maximum cosine distance; defaults to `0.45`.
- `RAG_CHUNK_SIZE`, `RAG_CHUNK_OVERLAP`: character chunk settings; defaults to
  `700` and `100`.
- `RAG_MAX_UPLOAD_BYTES`: upload size limit; defaults to 10 MiB.
- `RAG_DATABASE_PATH`: SQLite document-status database path.

HTTP CORS and WebSocket `Origin` validation use the same origin allowlist.

## WebSocket protocol

Send a chat request:

```json
{
  "type": "chat.send",
  "requestId": "request-123",
  "conversationId": "conversation-123",
  "message": "Hi",
  "ragMode": "hybrid",
  "documentIds": ["optional-selected-document-id"]
}
```

`ragMode` can be `hybrid` or `document-only`. Omitting `documentIds` searches
all ready documents owned by the authenticated user. Supplying one or more IDs
limits retrieval after server-side ownership and readiness validation.

The server emits `connection.ready`, `chat.started`, one or more `chat.delta`
messages, then `chat.complete`. Failures use `chat.error`. A running request
can be cancelled with:

```json
{ "type": "chat.cancel", "requestId": "request-123" }
```

When the model reaches its output limit or the conversation exceeds its context
window, the server sends a UI-safe error:

```json
{
  "type": "chat.error",
  "requestId": "request-123",
  "conversationId": "conversation-123",
  "code": "TOKEN_LIMIT_EXCEEDED",
  "message": "This conversation exceeded the AI token limit. Ask for a shorter answer or start a new conversation.",
  "retryable": false
}
```

Rate-limit errors use `code: "RATE_LIMITED"` and `retryable: true`. When the
server or provider supplies a wait duration, the payload includes
`retryAfterMs`, `retryAfterSeconds`, and a human-readable message such as
`"Too many requests. Try again in 12 seconds."`.

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
