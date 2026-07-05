const { DatabaseSync } = require("node:sqlite");
const path = require("path");
const fs = require("fs");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "..", "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, "warden.sqlite");
const db = new DatabaseSync(DB_PATH);

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  api_key TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT
);

CREATE TABLE IF NOT EXISTS policies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  match_type TEXT NOT NULL,        -- 'action_type' | 'target_regex' | 'param_regex' | 'rate_limit'
  match_field TEXT,                -- which field to inspect for regex types
  pattern TEXT,                    -- regex or action type string
  action_type_filter TEXT,         -- if set, policy only applies when action's actionType matches this (comma-separated allowed)
  decision TEXT NOT NULL,          -- 'block' | 'flag' | 'allow'
  risk_weight INTEGER NOT NULL DEFAULT 10,
  enabled INTEGER NOT NULL DEFAULT 1,
  rate_limit_count INTEGER,
  rate_limit_window_secs INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS actions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  target TEXT,
  params_json TEXT,
  risk_score INTEGER NOT NULL DEFAULT 0,
  decision TEXT NOT NULL,          -- 'allow' | 'flag' | 'block'
  matched_policies_json TEXT,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);

CREATE INDEX IF NOT EXISTS idx_actions_agent ON actions(agent_id);
CREATE INDEX IF NOT EXISTS idx_actions_created ON actions(created_at);
CREATE INDEX IF NOT EXISTS idx_actions_decision ON actions(decision);
`);

module.exports = db;
