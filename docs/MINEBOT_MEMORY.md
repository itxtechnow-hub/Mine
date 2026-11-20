# MineBot Project Memory

This file is the quick context handoff for future MineBot work. Read it before making changes.

## Project identity
- Product: MineBot, a private personal AI gateway and agent workspace.
- Repository: `itxtechnow-hub/Mine`.
- Production domain: `https://mine-console.vercel.app`.
- Keep MineBot as the product identity. Agora is a behavior/reference point, not a replacement product.

## Safety and deployment rules
- Preserve production data, provider credentials, vault contents, and storage.
- Never print, copy, commit, or ask the user to share API keys, tokens, passwords, backup codes, or environment secrets.
- Keep the free Vercel plan. Do not change billing.
- Production deploys only from GitHub `main`; never promote preview deployments to production.
- Do not merge to `main`, deploy, migrate production data, or change production settings without fresh explicit approval.
- Develop and test on a feature branch. Keep local/test data separate from production.
- Do not run destructive dependency upgrades such as `npm audit fix --force` without reviewing impact.

## Git state
- Active feature branch: `feat/agora-subagents-automation`.
- Feature branch base synced from GitHub: `61847ecad636f1f272ec5e416db19aaed20e6df1` (`Add durable subagents, automation, MCP and skills`).
- Production `main` known-good baseline: `a6ebbd7804380c7c404fd6fbb3f0fb994dfcca82`; verify current refs before work.
- This file is a handoff note, not a substitute for checking Git status and fetching latest changes.

## Product goals
- Lightweight OmniRoute-like gateway using Vercel AI Gateway and AI SDK.
- Private login/workspace; no public create-account flow. Provider setup belongs in Settings.
- Support many providers, visible base URLs, API-key-only setup where supported, multiple keys per provider, model discovery/sync, enabled-model selection, and usage tracking where supported.
- Responsive UI, including narrow Android screens.
- Main chat agent is the coordinator. It uses the selected model and can delegate to persistent subagents, each with its own model.
- Team/Flow should be simple by default: one Agent node connected to one Model node. The agent can create/manage subagents; users can replace failed model assignments.
- Keep Cloud Memory separate. Skills and MCP management should be together in the Skills area, with trust/approval controls for installing MCP servers.
- Support automation creation and scheduling, with approval gates for sensitive actions.

## Architecture map
- Node.js app; static frontend in `public/`, API handlers in `api/`, shared runtime modules in `lib/`.
- Local development: `npm run dev` (see `dev-server.js`).
- Tests/checks: `npm test`, `npm run check`, `git diff --check`.
- Agent runtime/queue: `lib/agent-runtime.js`, `lib/queue-http.js`, `api/agent-worker.js`.
- Automation: `lib/automation.js`, `lib/scheduler.js`, `lib/automation-worker.js`, `api/automation-worker.js`, `api/automation.js`.
- Cloud Memory: `lib/cloud-memory.js`, UI `public/src/ui/js/views/memory.js`.
- Skills: `public/src/ui/js/views/skills.js`, `lib/skills.js`.
- Providers: `lib/provider-directory.js`, `lib/provider-catalog.js`, `lib/model-discovery.js`, UI `public/src/ui/js/views/providers.js`.
- Team/Flow UI: `public/src/ui/js/views/teams.js`.

## Current user-reported issues / requested work
1. Provider forms: show Cloudflare Account ID only when Cloudflare Workers AI is selected; OpenRouter and other providers should not show Cloudflare-specific fields.
2. Team/Flow: remove duplicate model-selection modal. Clarify model assignment so Agent and Model node are not both independently asking for the same model.
3. Team/Flow: fix incorrect model label appearing inside Input/Output nodes.
4. Delegation: fix `delegate failed` when a simple Agent node is connected to a Model node; add regression tests.
5. Skills: add import/upload/paste option for a `SKILL.md` file.
6. Skills/MCP: move MCP install and management into Skills; retain trust checks and user approval before enabling untrusted servers.
7. Cloud Memory: keep it separate from Skills/MCP. Review per-model permissions UX; current implementation enforces per-model overrides, so do not remove backend authorization without confirming the intended security model.
8. Gateway keys: support multiple gateway API keys, with labels and individual revocation; do not reveal stored secrets after creation.
9. Automations: allow agents to create automation definitions/tools and schedules; use permission checks and approval for sensitive actions.
10. Password recovery: add secure backup/recovery codes. Display generated codes once, store only secure hashes, rate-limit attempts, and invalidate each code after successful use. Never add an unauthenticated password reset bypass.
11. Developer workflow: user wants to clone the latest feature branch onto their PC and work there instead of Codespaces. Keep the persistent cloned workspace available as a separate development resource.

## Important implementation notes
- Cloudflare Workers AI requires an Account ID as well as its API token; show that field only for this provider.
- Vercel Queues supports up to 7-day TTL/delay in current docs (April 2026 update). Existing 604800-second settings are valid; do not reintroduce an incorrect 24-hour cap.
- Codespaces/local dev does not automatically run Vercel Queue consumers or deployment triggers. Queue-backed automation/agent execution needs deployed queue workers or a deliberate local worker harness.
- Local `.data` storage is separate from production. Never point local tests at production storage.
- Cloud Memory currently has workspace defaults plus model-specific permission overrides; tests verify this behavior.
- Avoid the old GitHub REST blob/source-transfer approach that previously corrupted a transfer. Use normal Git clone/fetch/push or the supported GitHub contents action.

## Clone and run on your PC
For a private repository, authenticate with GitHub first, then run:
```bash
git clone --branch feat/agora-subagents-automation --single-branch https://github.com/itxtechnow-hub/Mine.git
cd Mine
npm ci
npm test
npm run check
npm run dev
```
Open `http://localhost:3000`. Keep `.env` and `.env.local` private and never commit them. To update:
```bash
git pull --ff-only origin feat/agora-subagents-automation
```

## Working style
- Make focused changes; do not rewrite working gateway code unnecessarily.
- Add/update tests for every bug fix and feature.
- Run `npm test`, `npm run check`, and `git diff --check` before reporting completion.
- Report exactly what changed, what tests ran, and remaining limitations.
- Never claim something is fixed, deployed, or tested unless the relevant command or live check confirms it.
