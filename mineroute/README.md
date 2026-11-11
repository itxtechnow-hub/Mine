# MineRoute — Full-Stack Next.js AI Gateway & Multi-Node Team Orchestrator

MineRoute is a self-hosted Next.js AI Router, Multi-Provider Proxy, 12-Engine Prompt Compressor, MCP Server, and Autonomous Multi-Agent Team Orchestrator.

## Quick Start (Next.js Backend + Frontend on Port 20128)
```bash
npm install
npm run dev
# Opens http://127.0.0.1:20128
```

## Key Backend & Frontend Capabilities
1. **Preserved MineRoute Glassmorphic Frontend (`public/css/mine.css`)**: Exact sidebar, topbar, dark/light theme toggle, and Interactive Team Flow Canvas.
2. **Upgraded Multi-Agent Team Orchestrator (`src/lib/team-orchestrator.ts` & `/api/teams/run` & `MineRoute/team/Mine`)**:
   - **Stage 1 (Lead Agent `/agent`)**: Inspects workspace files (`file_list`) and persistent memory (`memory_read`) to ground the mission brief.
   - **Stage 2 (Boss Planner `/boss`)**: Checks gateway status (`get_gateway_status`) and decomposes the task into parallelizable worker assignments with bound built-in tools.
   - **Stage 3 (Workers `/worker` & Peer Reviewer)**: Executes tasks, writes deliverables to `./data/skills/workspaces/` (`file_write`), runs `code_eval` and `compress_prompt` verification, and exchanges peer sign-off notes on the Team Blackboard.
   - **Stage 4 (Context Memory `/memory`)**: Indexes session takeaways into `./data/skills/memory.json` (`memory_store`).
   - **Stage 5 (Final Deliverable Synthesis)**: Returns both collapsible per-stage inter-agent communication subchats and the final synthesized deliverable.
3. **Real Backend API Routes (Zero Emulated Data)**:
   - `POST /v1/chat/completions` & `GET /v1/models` — OpenAI-compatible proxy supporting `MineRoute/team/*`, `auto` (19 routing strategies), 4-tier failover, semantic response caching (`X-MineRoute-Cache`), and automatic built-in tool execution.
   - `GET /api/store/all` & `POST /api/store/sync` — Local state persistence inside `./data/store.json` with `AES-256-GCM` key encryption.
   - `POST /api/mcp/rpc`, `GET /api/mcp/v1/tools`, `POST /api/mcp/v1/call`, `POST /api/skills/call` — Built-in MCP JSON-RPC 2.0 & sandboxed skills server.
   - `POST /api/providers/ping` — Real HTTP reachability and latency probing.
   - `POST /api/compress` & `POST /api/translate` — 12-engine token compression and cross-protocol payload translation.
