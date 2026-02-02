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

## How This Was Built

### Phase 1: Base Voice Agent Setup
1. Cloned Christian Bromann's `createVoiceAgent` repo
2. Configured Hume.ai for emotionally expressive TTS
3. Set up the playground for voice testing

### Phase 2: Authentication (Neon Auth)
1. Created Neon project with `neon_auth` schema
2. Integrated Better Auth with Google OAuth
3. Added `UserButton` component and session management
4. User profile stored in Neon database

### Phase 3: Memory Integration (Zep)
1. Set up Zep Cloud account and graph (`fractional-jobs-graph`)
2. Created Zep client library (`frontend/src/lib/zep/client.ts`)
3. Built `useZepMemory` hook for React integration
4. Added memory prompts to CopilotKit instructions

### Phase 4: LangGraph Agent with HITL
1. Created `agent/` directory with LangGraph careers coach
2. Defined tools with `interrupt()` for Human-in-the-Loop
3. Integrated CopilotKit SDK (`CopilotKitStateAnnotation`)
4. Connected CopilotKit runtime to LangGraph agent via `LangGraphAgent`

### Phase 5: Unified Architecture (Current)
1. CopilotKit chat UI connected to LangGraph agent
2. Voice agent and chat share same backend (in progress)
3. HITL confirmations work via `interrupt()` → frontend handling

## External Resources & Links

### Documentation
- **CopilotKit LangGraph**: https://docs.copilotkit.ai/langgraph
- **CopilotKit HITL**: https://docs.copilotkit.ai/langgraph/human-in-the-loop
- **CopilotKit useAgent Hook**: https://docs.copilotkit.ai/langgraph/use-agent-hook
- **LangGraph.js**: https://langchain-ai.github.io/langgraphjs/
- **Zep Memory**: https://help.getzep.com/
- **Neon Auth**: https://neon.tech/docs/guides/neon-auth
- **Hume.ai**: https://dev.hume.ai/

### Reference Projects
- **createVoiceAgent**: https://github.com/christian-bromann/createVoiceAgent
- **CopilotKit with LangGraph JS**: https://github.com/CopilotKit/with-langgraph-js
- **Deep Agents Job Search**: https://github.com/CopilotKit/deep-agents-job-search-assistant

### Services & Accounts
| Service | Purpose | Dashboard |
|---------|---------|-----------|
| Neon | Database + Auth | https://console.neon.tech |
| Zep | Memory/Context | https://app.getzep.com |
| OpenAI | LLM (GPT-4o) | https://platform.openai.com |
| Hume.ai | Emotional TTS | https://beta.hume.ai |
| Google Cloud | OAuth | https://console.cloud.google.com |
| Railway | Deployment | https://railway.app |

## Key Files Explained

### Agent
| File | Purpose |
|------|---------|
| `agent/src/graph.ts` | Main LangGraph agent with tools and HITL |
| `agent/src/server.ts` | Custom Hono server (fallback/voice) |
| `agent/langgraph.json` | LangGraph CLI config for dev server |

### Frontend
| File | Purpose |
|------|---------|
| `frontend/src/app/api/copilotkit/route.ts` | CopilotKit runtime → LangGraph connection |
| `frontend/src/app/api/zep/route.ts` | Zep memory API endpoints |
| `frontend/src/app/page.tsx` | Main dashboard with voice + chat |
| `frontend/src/app/layout.tsx` | CopilotKit + Neon Auth providers |
| `frontend/src/lib/auth/server.ts` | Better Auth configuration |
| `frontend/src/lib/zep/client.ts` | Zep SDK client |
| `frontend/src/hooks/useZepMemory.ts` | React hook for Zep integration |

## TODO - Prioritized

### High Priority (Next Steps)
- [ ] **Connect voice agent to LangGraph** - Modify playground to call shared agent
- [ ] **Add HITL pill buttons** - Use `useLangGraphInterrupt` hook for UI confirmations
- [ ] **Test voice + chat unified** - Ensure both interfaces use same agent state

### Medium Priority
- [ ] **Persist agent state to Neon** - Store user profiles in database
- [ ] **Improve Zep memory prompts** - Better fact extraction for career info
- [ ] **Add job search APIs** - Integrate LinkedIn/Indeed for real job listings

### Low Priority / Future
- [ ] **Resume analysis tool** - Parse and evaluate uploaded resumes
- [ ] **Interview prep mode** - Practice questions with voice feedback
- [ ] **Deploy to Railway** - Production deployment of agent
- [ ] **Vercel deployment** - Production frontend with environment variables

## Implementation Details for Next Steps

### 1. Connect Voice Agent to LangGraph

The voice agent in `playground/` currently uses its own agent. To unify:

```typescript
// In playground/src/index.ts or agent.ts
// Replace direct LLM calls with:
const response = await fetch('http://localhost:8123/runs', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    assistant_id: 'careers_coach',
    thread_id: threadId,
    input: { messages: [{ role: 'human', content: userMessage }] },
  }),
});
```

### 2. Add HITL Pill Buttons in CopilotKit

Use the `useLangGraphInterrupt` hook or custom event handling:

```typescript
// In frontend/src/app/page.tsx
import { useAgent } from "@copilotkit/react-core/v2";
import type { AgentSubscriber } from "@ag-ui/client";

function HITLHandler() {
  const { agent } = useAgent();
  const [interrupt, setInterrupt] = useState<{ message: string } | null>(null);

  useEffect(() => {
    const subscriber: AgentSubscriber = {
      onCustomEvent: ({ event }) => {
        if (event.name === "on_interrupt") {
          setInterrupt({ message: event.value });
        }
      },
    };
    const { unsubscribe } = agent.subscribe(subscriber);
    return () => unsubscribe();
  }, []);

  const handleResponse = (response: string) => {
    agent.runAgent({
      forwardedProps: { command: { resume: response } },
    });
    setInterrupt(null);
  };

  if (!interrupt) return null;

  return (
    <div className="fixed bottom-20 left-1/2 transform -translate-x-1/2 bg-white p-4 rounded-lg shadow-lg">
      <p>{interrupt.message}</p>
      <div className="flex gap-2 mt-2">
        <button onClick={() => handleResponse("yes")} className="px-4 py-2 bg-green-500 text-white rounded">
          Confirm
        </button>
        <button onClick={() => handleResponse("no")} className="px-4 py-2 bg-red-500 text-white rounded">
          Cancel
        </button>
      </div>
    </div>
  );
}
```

### 3. Voice Confirmation Prompts

For voice HITL, the agent should use Hume's emotional TTS:
- Use questioning tone for soft confirmations
- Use serious/emphatic tone for hard confirmations (job applications)

## Debugging

### Check Agent Logs
```bash
tail -f /var/folders/xn/.../tasks/*.output
# Or check LangGraph Studio: https://smith.langchain.com/studio?baseUrl=http://localhost:8123
```

### Test Agent Directly
```bash
curl -X POST http://localhost:8123/runs \
  -H "Content-Type: application/json" \
  -d '{"assistant_id":"careers_coach","thread_id":"test-123","input":{"messages":[{"role":"human","content":"Hello"}]}}'
```

### Common Debug Commands
```bash
# Check running servers
lsof -i :8123  # Agent
lsof -i :3002  # Frontend
lsof -i :3001  # Voice playground

# Kill stuck processes
lsof -ti:PORT | xargs kill -9

# Check Neon connection
psql $DATABASE_URL -c "SELECT * FROM user LIMIT 1;"
```
