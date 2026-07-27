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

## Scripts

- `npm run dev` starts the TypeScript server in watch mode.
- `npm run build` creates the `dist` build.
- `npm start` runs the production build.
- `npm run lint` checks the source.
