# Careers Voice Assistant - Claude Code Instructions

## Project Overview

This is a careers voice assistant built on top of Christian Bromann's `createVoiceAgent` repo, integrating:

- **Hume.ai** - Emotionally expressive text-to-speech
- **LangGraph** - Multi-node agent with Human-in-the-Loop (HITL) capabilities
- **CopilotKit** - React chat UI with agent state visualization
- **Neon Auth** - Authentication via Better Auth with Google OAuth
- **Zep** - Long-term memory and context management

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                            Frontend (Next.js)                       │
│  ┌─────────────┐    ┌─────────────┐    ┌──────────────────────────┐│
│  │ Voice Agent │    │ CopilotKit  │    │       Neon Auth          ││
│  │  (Hume TTS) │    │  Chat UI    │    │  (Google OAuth)          ││
│  └──────┬──────┘    └──────┬──────┘    └──────────────────────────┘│
└─────────┼──────────────────┼───────────────────────────────────────┘
          │                  │
          │    ┌─────────────┴──────────────┐
          │    │                            │
          ▼    ▼                            ▼
┌─────────────────────────┐      ┌─────────────────────────┐
│   LangGraph Agent       │      │      Zep Memory         │
│   (Port 8123)           │      │   (Cloud API)           │
│   - Career coaching     │      │   - Context retrieval   │
│   - Profile management  │      │   - Fact extraction     │
│   - Job search          │      │   - Knowledge graph     │
│   - HITL confirmations  │      │                         │
└─────────────────────────┘      └─────────────────────────┘
```

## Directory Structure

```
/christian-fractional/
├── core/                    # Voice agent core (from createVoiceAgent)
├── provider/                # STT/TTS providers (Hume, etc.)
├── playground/              # Development environment
├── agent/                   # LangGraph careers coach agent
│   ├── src/
│   │   ├── graph.ts         # Main LangGraph agent with HITL tools
│   │   └── server.ts        # Custom Hono server (fallback)
│   ├── langgraph.json       # LangGraph CLI configuration
│   └── package.json
├── frontend/                # Next.js + CopilotKit UI
│   ├── src/
│   │   ├── app/
│   │   │   ├── api/copilotkit/  # CopilotKit runtime endpoint
│   │   │   ├── api/zep/         # Zep memory API
│   │   │   ├── api/auth/        # Auth endpoints
│   │   │   ├── page.tsx         # Main dashboard
│   │   │   └── layout.tsx       # Root layout with providers
│   │   ├── lib/
│   │   │   ├── auth/            # Better Auth client/server
│   │   │   └── zep/             # Zep client configuration
│   │   └── hooks/
│   │       └── useZepMemory.ts  # Zep memory React hook
│   └── package.json
└── pnpm-workspace.yaml
```

## Environment Variables

### Agent (.env)
```
OPENAI_API_KEY=sk-...
AGENT_PORT=8123
```

### Frontend (.env.local)
```
# Auth
DATABASE_URL=postgresql://...@ep-xxx.region.aws.neon.tech/neondb
BETTER_AUTH_SECRET=...
BETTER_AUTH_URL=http://localhost:3002

# Google OAuth
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...

# Zep Memory
ZEP_API_KEY=z_...
ZEP_GRAPH_NAME=fractional-jobs-graph

# LangGraph Agent
LANGGRAPH_DEPLOYMENT_URL=http://localhost:8123
LANGSMITH_API_KEY=... (optional)
```

## Running the Project

### 1. Start the LangGraph Agent
```bash
cd agent
pnpm dev
# This runs: npx @langchain/langgraph-cli dev --port 8123 --no-browser
```

### 2. Start the Frontend
```bash
cd frontend
pnpm dev
# Runs on http://localhost:3002
```

### 3. (Optional) Start the Voice Playground
```bash
cd playground
pnpm dev
# Runs on http://localhost:3001
```

## Key Features

### Human-in-the-Loop (HITL)

The agent uses LangGraph's `interrupt()` function for confirmations:

- **Soft Confirmations**: Profile updates, skill changes
- **Hard Confirmations**: Job applications (requires explicit "yes, apply")

```typescript
// Example from agent/src/graph.ts
const saveProfile = tool(async ({ skills, experienceYears, ... }) => {
  const userResponse = interrupt("I'd like to save your profile with: ...");
  if (userResponse?.toLowerCase().includes('yes')) {
    return { success: true, ... };
  }
  return { success: false, ... };
}, { name: "save_profile", schema: z.object({...}) });
```

### CopilotKit Integration

CopilotKit connects to the LangGraph agent via:
- `LangGraphAgent` from `@copilotkit/runtime/langgraph`
- Agent state annotation: `CopilotKitStateAnnotation` from `@copilotkit/sdk-js/langgraph`
- Frontend actions converted to tools via `convertActionsToDynamicStructuredTools`

### Zep Memory

User context and conversation history is managed by Zep:
- Thread-based conversations
- Fact extraction and rating
- Knowledge graph queries

## Agent Tools

| Tool | Description | HITL Type |
|------|-------------|-----------|
| `save_profile` | Save user career profile | Soft |
| `update_skills` | Add/remove skills | Soft |
| `search_jobs` | Search job listings | None |
| `apply_to_job` | Submit job application | Hard |
| `end_conversation` | End the conversation | None |

## Development Notes

### TypeScript Configuration
- Agent uses ESM modules (`"type": "module"`)
- Target: ES2022
- Module: ESNext with bundler resolution

### Monorepo Setup
- Uses pnpm workspaces
- Packages: core, provider/*, playground, agent, frontend

### Common Issues

1. **Port conflicts**: Kill processes with `lsof -ti:PORT | xargs kill -9`
2. **Peer dependency warnings**: Can be ignored for most LangChain packages
3. **Module resolution**: Ensure `.js` extensions in relative imports

## Deployment

### Railway
The agent can be deployed on Railway:
```bash
railway init
railway up
```

### Vercel
Frontend deploys to Vercel automatically via git push.

## TODO

- [ ] Connect voice agent to shared LangGraph agent
- [ ] Add pill button UI for HITL confirmations in CopilotKit
- [ ] Test unified voice + chat with HITL
- [ ] Add job search API integrations (LinkedIn, Indeed)
- [ ] Implement resume analysis tool
