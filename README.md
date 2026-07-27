# Agentic Assistant backend

Express and TypeScript API for Agentic Assistant. Chat responses are streamed
over `POST /chat`, which works locally and as a Vercel Function.

## Local setup

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

The health check is available at `GET http://localhost:5000/health`.

## Environment variables

| Variable | Required on Vercel | Description |
| --- | --- | --- |
| `GROQ_API_KEY` | Yes | Secret API key from Groq. |
| `GROQ_MODEL` | Yes | Groq model ID, for example `openai/gpt-oss-120b`. |
| `CORS_ORIGIN` | Yes | Exact frontend origin, for example `https://your-fe.vercel.app`. Use commas for multiple origins. |
| `PORT` | No | Local server port. Vercel supplies its own runtime port. Defaults to `5000`. |

Add the required variables to Production, Preview, and Development in the
Vercel project if all three environments should work. Never expose
`GROQ_API_KEY` in the frontend project.

## Deploy as the backend Vercel project

1. Import this repository in Vercel as a new project.
2. Keep the project root at the repository root.
3. Vercel detects the included Express configuration; do not set an output
   directory.
4. Add the backend environment variables above.
5. Deploy, then verify `https://your-be.vercel.app/health`.

For local Vercel parity, install the Vercel CLI and run `vercel dev`.

## Scripts

- `npm run dev` starts the TypeScript server in watch mode.
- `npm run build` compiles the production server.
- `npm start` runs the compiled server.
- `npm run lint` checks the source.
