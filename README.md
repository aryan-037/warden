# Warden — AI Agent Security Platform

Warden watches what your AI agents are doing, blocks risky actions before they
execute, and keeps an immutable audit trail — so you find out about a problem
*before* it costs you money or data, not after.

## How it works

1. Your agent calls Warden's **interceptor endpoint** (`POST /v1/actions/check`)
   right before it executes a tool call — a shell command, a file write, an
   HTTP request, a purchase, anything.
2. Warden evaluates the proposed action against your **policies** (pattern
   rules with risk weights) and returns a decision: `allow`, `flag`, or `block`.
3. Every check is logged to an **audit trail**, streamed live to the dashboard
   over WebSocket, and available for filtering/export.
4. You manage agents, API keys, and policies from the dashboard — no redeploy
   needed to change a rule.

## Project structure

```
warden/
├── src/
│   ├── server.js          # Express app entry point
│   ├── db/                # SQLite schema + seed data (built-in node:sqlite)
│   ├── policies/engine.js # Core rule evaluation logic
│   ├── routes/            # REST API: auth, actions, agents, policies
│   ├── middleware/auth.js # JWT (dashboard) + API key (agents) auth
│   ├── ws/hub.js          # WebSocket broadcaster for live feed
│   ├── sdk/client.js      # Client library agents import
│   ├── sdk/simulateAgent.js # Demo traffic generator
│   └── public/            # Dashboard frontend (vanilla HTML/CSS/JS)
├── Dockerfile
├── render.yaml            # One-click Render.com deploy config
└── .env.example
```

## Local setup

Requires **Node.js 22.5+** (uses the built-in `node:sqlite` module — no native
compilation, no external database needed).

```bash
npm install
cp .env.example .env      # edit JWT_SECRET and ADMIN_PASSWORD
npm start
```

Open http://localhost:8080 and log in with the seeded admin account (email/password
printed in the console on first run, or whatever you set in `.env`).

### Try the demo traffic simulator

Create an agent from the **Agents** tab in the dashboard to get an API key, then:

```bash
WARDEN_URL=http://localhost:8080 WARDEN_API_KEY=wd_your_key node src/sdk/simulateAgent.js
```

Watch the Overview page — a mix of safe, flagged, and blocked actions will
stream in live.

## Wiring up a real agent

```js
const Warden = require('./src/sdk/client');
const warden = new Warden({
  baseUrl: 'https://your-warden-instance.com',
  apiKey: process.env.WARDEN_API_KEY,
});

const decision = await warden.check({
  actionType: 'shell_exec',
  target: '/tmp',
  params: { command: userSuppliedCommand },
});

if (decision.decision === 'block') {
  throw new Error(`Blocked by Warden: ${decision.reason}`);
}
// proceed with the actual tool call
```

Or use the `guard()` wrapper to combine the check and the action in one call —
see the **Integrate** tab in the dashboard for a live example with your own
API key pre-filled.

## Policy engine

Policies live in the database and are fully editable from the dashboard — no
code changes needed. Each policy has:

- **match_type**: `action_type` (exact match), `target_regex` (regex on the
  action's target), `param_regex` (regex on a specific param or all params),
  or `rate_limit` (N actions per time window).
- **action_type_filter**: optionally scope a rule to only apply to certain
  action types (e.g. a "destructive command" rule should only ever look at
  `shell_exec`/`code_exec`, not every action).
- **decision**: `allow`, `flag`, or `block`.
- **risk_weight**: contributes to the action's overall 0–100 risk score.

Multiple policies can match the same action; the most severe decision wins
(`block` > `flag` > `allow`) and risk weights sum (capped at 100).

Six starter policies are seeded on first run: destructive shell commands,
filesystem writes outside a sandbox, unknown outbound network hosts,
credential/secret access, high-value spend actions, and an action-burst rate
limiter.

## Deploying live

### Option A — Render.com (easiest, has a free tier)

1. Push this project to a GitHub repo.
2. In Render, click **New → Blueprint**, point it at your repo — it will read
   `render.yaml` automatically.
3. Set the `ADMIN_PASSWORD` environment variable when prompted (it's marked
   `sync: false` so Render will ask for it rather than storing it in the repo).
4. Deploy. Render builds the Dockerfile and gives you a public URL.
5. **Important**: check Render's current docs for persistent disk pricing on
   your plan if you need the audit log to survive redeploys long-term. For a
   real production database, plan to migrate from SQLite to Postgres (see
   "Scaling up" below).

### Option B — Railway / Fly.io / any Docker host

The included `Dockerfile` works anywhere that runs containers:

```bash
docker build -t warden .
docker run -p 8080:8080 \
  -e JWT_SECRET=$(openssl rand -hex 32) \
  -e ADMIN_PASSWORD=your-password \
  -v warden-data:/app/data \
  warden
```

### Option C — A plain VPS

```bash
git clone <your-repo>
cd warden
npm install
cp .env.example .env   # edit values
npm start
```
Put it behind Nginx/Caddy for HTTPS and process-manage it with `pm2` or a
systemd unit.

## Scaling up (roadmap ideas)

This MVP is intentionally built to be real and demoable fast. Natural next
steps for a production version:

- **Postgres** instead of SQLite once you have concurrent write load or need
  managed backups.
- **Multi-tenant orgs** — right now all agents/policies belong to one
  workspace; add an `org_id` column and scope everything to it.
- **Alerting** — webhook/Slack/email notification when a `block` fires, not
  just a dashboard update.
- **Policy versioning & simulation** — "dry run" a new policy against
  historical traffic before enabling it, so you can see what it *would have*
  blocked.
- **Signed action receipts** — cryptographically sign each decision so the
  audit trail is independently verifiable (useful for compliance evidence).
- **Python SDK** — the interceptor is a plain REST endpoint, so a Python
  client is a straightforward port of `src/sdk/client.js`.

## Security notes for this MVP

- Change `JWT_SECRET` and `ADMIN_PASSWORD` before deploying anywhere public —
  the defaults are for local dev only.
- Dashboard auth is single-admin-role for now; add proper RBAC before letting
  a team share one instance.
- Rate-limit the `/v1/actions/check` endpoint itself in a reverse proxy if
  you expect very high-volume agents, to protect the SQLite write path.
