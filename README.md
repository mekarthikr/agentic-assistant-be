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

The repository includes a Vercel Function entry point and routing
configuration. Import the repository in Vercel, keep the project root at the
repository root, and configure these environment variables:

- `GROQ_API_KEY` (required)
- `GROQ_MODEL` (optional)
- `ENTERPRISE_API_BASE_URL` (optional)
- `SOCKET_AUTH_TOKEN` (recommended for public deployments)

Do not set `PORT`. Vercel supplies the HTTP server. The generated RAG index is
automatically written to the function's temporary directory, while its source
Markdown is bundled with the function.

After deployment, verify `GET /health`. WebSocket clients connect to
`wss://<deployment-domain>/ws` and must reconnect if a function instance is
recycled.

## Enterprise tools

The Markdown file at `src/docs/enterprise-api-documentation.md` is the source of
truth for enterprise API tools. At startup the backend:

1. Parses each documented endpoint, parameter, method, and path.
2. Builds a deterministic sparse-vector RAG index.
3. Stores the index at `src/rag/enterprise-api-index.json`.
4. Reuses the stored index until the source document hash changes.
5. Retrieves the most relevant endpoint documentation for each conversation.
6. Generates and exposes only the matching read-only tools to Groq.

There are no contract- or application-specific tool schemas in the code.
Adding or changing a documented `GET` endpoint updates the generated tools
after the server restarts. The generic executor validates model input against
the parameters parsed from the documentation and confines requests to
`ENTERPRISE_API_BASE_URL`.

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
- `ENTERPRISE_API_DOC_PATH`: source Markdown API documentation.
- `ENTERPRISE_RAG_INDEX_PATH`: generated persistent retrieval index.
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

The base insurance behavior and safety instructions live in
`src/prompts/insurance-assistant.prompt.ts`. The orchestrator applies this
prompt to every model request and appends retrieved enterprise documentation
only when it matches the conversation.

The generated RAG index is runtime data and is excluded from Git. Delete it to
force a rebuild, although editing the source document also rebuilds it
automatically.

## Scripts

- `npm run dev` starts the TypeScript server in watch mode.
- `npm run build` creates the `dist` build.
- `npm start` runs the production build.
- `npm test` builds and verifies documentation parsing and retrieval.
- `npm run lint` checks the source.
