# Private Telegram Manager

## Environment variables
- TELEGRAM_BOT_TOKEN: BotFather token. Server-side only; never commit it.
- TELEGRAM_OWNER_ID: your personal numeric Telegram user ID (not the bot ID).
- TELEGRAM_WEBHOOK_SECRET: random 32+ character secret using letters, digits, underscore or hyphen.
- TELEGRAM_MINI_APP_URL: optional HTTPS URL, normally https://YOUR_DOMAIN/telegram-manager.html.
- MINE_PUBLIC_URL: optional canonical Mine origin.

Rotate any bot token previously pasted into chat before production.

## Setup
1. Add the environment variables to Vercel.
2. Deploy this branch.
3. Open the bot in a private one-to-one chat and send /start.
4. Send /setwebhook as the owner. It registers https://YOUR_DOMAIN/api/telegram with Telegram's webhook secret.
5. Open the Private Manager button.

## Security
- Webhook verifies Telegram's X-Telegram-Bot-Api-Secret-Token header.
- Bot commands and callbacks require TELEGRAM_OWNER_ID and a one-to-one chat.
- Every Mini App request validates Telegram initData HMAC, owner ID and a five-minute auth_date window.
- RPC methods are allowlisted. The Mini App cannot call arbitrary Mine RPC methods.
- API keys are never returned to the Mini App or chat. Enter keys only in the HTTPS Mini App, not chat messages.
- Existing Mine dispatch, encrypted storage, Teams, model queue, providers and Cloud Memory are reused.
- The Mini App has no independent account or public registration.

## Included sections
Overview, API Keys, Providers, Models / Model Queue, Team JSON editor, Cloud Memory / MCP inventory, Analytics, and gateway status. In this Mine version, orchestration is stored in the Teams collection; no separate Flow schema is added.
