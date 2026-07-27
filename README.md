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

For a local Vercel-compatible runtime, install the Vercel CLI and run:

```bash
npm run dev:vercel
```

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

The production server uses Groq, the RAG-selected generated tools, and the
documented enterprise API provider. A deterministic mock provider remains
available for isolated development and testing.

## Insurance-agent behavior

Every model turn receives an insurance-only system prompt. The model performs
the semantic decision: it answers general insurance questions directly, refuses
unrelated requests, or selects a relevant API tool when the answer requires
current or customer-specific data. The orchestration layer remains in control
of execution: it validates and runs the selected tool, returns the API result to
the model, and lets the model format that result into a concise answer.

The prompt also requires the agent to ask for missing required parameters,
preserve API values exactly, avoid inventing records, and report tool failures
honestly.

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

The generated RAG index is stored with the source so Vercel can bundle it into
the Function. Editing the source document and running the build regenerates it.

## Vercel deployment

The same Express and native WebSocket server is exported through
`api/index.ts`. Standalone development listens on `PORT`; Vercel consumes the
exported server without opening a second listener.

Configure these environment variables in the Vercel project:

- `GROQ_API_KEY`
- `GROQ_MODEL`
- `ENTERPRISE_API_BASE_URL`
- `SOCKET_AUTH_TOKEN`

Then deploy from the repository root:

```bash
vercel
```

The build regenerates `src/rag/enterprise-api-index.json`, while `vercel.json`
ensures that both the source documentation and stored index are included in
the Function bundle. WebSocket connections are limited by the Function's
maximum duration, so clients should reconnect with backoff after a disconnect.

## Scripts

- `npm run dev` starts the TypeScript server in watch mode.
- `npm run dev:vercel` runs through the Vercel development runtime.
- `npm run build` creates `dist` and regenerates the stored RAG index.
- `npm run rag:build` regenerates the stored documentation index after a build.
- `npm start` runs the production build.
- `npm test` builds and verifies documentation parsing and retrieval.
- `npm run lint` checks the source.
