# Mine — Vercel edition

**Hosted AI gateway, key manager, and model router.**

Mine pools API keys across 250+ providers and serves them from one
OpenAI-compatible endpoint. Point any OpenAI client at it — Cline, Continue,
Aider, Open WebUI, a script — and it routes, rotates keys, and fails over on
its own. This edition runs entirely on Vercel: a static console plus two
serverless functions, with your vault stored encrypted in **Vercel Blob** (or
Upstash Redis / Vercel KV).

---

## Deploy (5 minutes)

1. **Push this folder to a GitHub repo** (or run `npx vercel` inside it).
2. In Vercel: **Add New → Project → Import** the repo. Framework preset:
   **Other**. Leave build settings as they are (`vercel.json` sets them).
3. **Storage → Create → Blob** → connect it to the project. This adds
   `BLOB_READ_WRITE_TOKEN` automatically.
   *(Alternative: Storage → Marketplace → Upstash Redis. Mine picks it up from
   `KV_REST_API_URL` / `KV_REST_API_TOKEN` and prefers it when both exist.)*
4. **Settings → Environment Variables** → add `MINE_SECRET` = a long random
   string:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
5. **Redeploy.** Open your `https://<project>.vercel.app`, create the console
   password on the first screen, and you're in.

> Create the password right after deploying: until it exists, whoever opens
> the URL first sets it. Or set `MINE_ADMIN_PASSWORD` before the first deploy.

### With the CLI

```bash
npm i -g vercel
vercel link
vercel blob store add mine-vault        # or connect a store in the dashboard
vercel env add MINE_SECRET production
vercel --prod
```

---

## Use it

In the console, add API keys (**API Keys → + Add Key**), press **Fetch
models**, build your **Model Queue**, then copy the gateway key from
**Settings → Connect Your Client**.

```bash
curl https://<project>.vercel.app/v1/chat/completions \
  -H "Authorization: Bearer <gateway-key>" \
  -H "Content-Type: application/json" \
  -d '{"model":"mine/auto","messages":[{"role":"user","content":"Hello"}]}'
```

| Route | Auth | Purpose |
|---|---|---|
| `GET /health` | no | Liveness check |
| `GET /v1/models` | gateway key | Every model the gateway can serve |
| `POST /v1/chat/completions` | gateway key | Chat (streaming supported) |
| `POST /v1/completions` | gateway key | Legacy completions |
| `POST /v1/embeddings` | gateway key | Embeddings |

**Model names**

- `provider/model` — e.g. `groq/llama-3.3-70b-versatile`.
- `mine/auto` — walks your Model Queue top-down; a model that rate-limits,
  404s, errors, or runs out of credit falls through to the next one.
- `mine/agent/<slug>` — runs a Team (planner → workers → synthesizer).

**Key rotation** — several keys for one provider are spread by least use, then
latency. `429` → cooldown, `401/403` → dead, `402` → out of credit; each
immediately retries on the next key.

---

## How it works

```
public/                 the console (static, unchanged UI)
  src/ui/js/lib/web-bridge.js   recreates the old Electron `window.vault`
                                API over fetch('/api/rpc')
api/rpc.js              console API: auth, keys, providers, models, teams, backups
api/gateway.js          /v1/* and /health (rewritten in vercel.json)
lib/storage.js          encrypted vault on Upstash Redis → Vercel Blob → /tmp
lib/gateway/            the proxy: routing, rotation, streaming, teams
lib/gateway-runtime.js  per-request gateway + persistence of key health & logs
dev-server.js           local runner that mirrors the deployment
```

## Security

- Vault encrypted with **AES-256-GCM** (key derived from `MINE_SECRET`) before
  it is written to Blob/Redis.
- Console password hashed with **PBKDF2-SHA512 (100k)**; sessions are signed
  `HttpOnly; Secure; SameSite=Strict` cookies, valid 7 days, revoked on
  password change. Brute force is throttled server-side.
- The gateway key is always required on a hosted deployment and compared in
  constant time. It can be rotated from Settings.
- Cross-origin calls to the console API are refused.
- Reset keeps your password and gateway key so the console never becomes
  claimable.

## Limits on Vercel

- Requests stream for up to **300 s** (`maxDuration` in `vercel.json`;
  Hobby plans with Fluid compute allow this).
- Local providers (Ollama, LM Studio, …) on `127.0.0.1` are not reachable from
  the cloud — expose them through a public URL and add them as a custom
  provider instead.
- Stats are written after each request; under heavy parallel traffic a usage
  counter can lag by a request or two. Redis gives the tightest consistency.

## Local development

```bash
npm install
cp .env.example .env      # optional; without storage vars data goes to ./.data
npm run dev               # http://localhost:3000
npm test
```

## License

MIT — Zohaib Asghar.
