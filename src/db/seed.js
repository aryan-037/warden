const { nanoid } = require("nanoid");
const bcrypt = require("bcryptjs");
const db = require("./index");

function seed() {
  const userCount = db.prepare("SELECT COUNT(*) as c FROM users").get().c;
  if (userCount === 0) {
    const email = process.env.ADMIN_EMAIL || "admin@warden.local";
    const password = process.env.ADMIN_PASSWORD || "warden123";
    const hash = bcrypt.hashSync(password, 10);
    db.prepare(
      "INSERT INTO users (id, email, password_hash, role) VALUES (?, ?, ?, 'admin')"
    ).run(nanoid(), email, hash);
    console.log(`Seeded admin user: ${email} / ${password} (change this in production)`);
  }

  const policyCount = db.prepare("SELECT COUNT(*) as c FROM policies").get().c;
  if (policyCount === 0) {
    const defaults = [
      {
        name: "Destructive shell commands",
        description: "Blocks shell/exec actions containing destructive patterns like rm -rf, mkfs, dd, shutdown.",
        match_type: "param_regex",
        match_field: "command",
        pattern: "(rm\\s+-rf|mkfs|:(\\)|\\{)|dd\\s+if=|shutdown|reboot|drop\\s+database|drop\\s+table)",
        decision: "block",
        risk_weight: 90,
        action_type_filter: "shell_exec,code_exec",
      },
      {
        name: "Filesystem writes outside sandbox",
        description: "Flags file write/delete actions targeting paths outside an allowed workspace directory.",
        match_type: "target_regex",
        match_field: "target",
        pattern: "^(?!/home/agent-workspace|/tmp).*",
        decision: "flag",
        risk_weight: 40,
        action_type_filter: "file_write,file_delete,file_read",
      },
      {
        name: "Outbound network to unknown host",
        description: "Flags http_request actions to a target not on a known allow-list domain.",
        match_type: "target_regex",
        match_field: "target",
        pattern: "^(?!.*(api\\.internal|trusted-vendor\\.com)).*",
        decision: "flag",
        risk_weight: 25,
        action_type_filter: "http_request",
      },
      {
        name: "Credential or secret access",
        description: "Blocks actions whose parameters reference credentials, API keys, tokens, or .env files.",
        match_type: "param_regex",
        match_field: "*",
        pattern: "(api[_-]?key|secret|password|\\.env|private[_-]?key|access[_-]?token)",
        decision: "block",
        risk_weight: 85,
      },
      {
        name: "High-cost spend action",
        description: "Flags actions where a numeric 'amount' or 'cost' parameter exceeds $100.",
        match_type: "param_regex",
        match_field: "*",
        pattern: "\"(amount|cost)\":\\s*([1-9][0-9]{2,}|[1-9][0-9][0-9]+)",
        decision: "flag",
        risk_weight: 30,
      },
      {
        name: "Agent action burst (rate limit)",
        description: "Flags an agent firing more than 20 actions within 10 seconds — possible runaway loop.",
        match_type: "rate_limit",
        match_field: null,
        pattern: null,
        decision: "flag",
        risk_weight: 20,
        rate_limit_count: 20,
        rate_limit_window_secs: 10,
      },
    ];

    const insert = db.prepare(`
      INSERT INTO policies
        (id, name, description, match_type, match_field, pattern, action_type_filter, decision, risk_weight, enabled, rate_limit_count, rate_limit_window_secs)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `);
    for (const p of defaults) {
      insert.run(
        nanoid(),
        p.name,
        p.description,
        p.match_type,
        p.match_field || null,
        p.pattern || null,
        p.action_type_filter || null,
        p.decision,
        p.risk_weight,
        p.rate_limit_count || null,
        p.rate_limit_window_secs || null
      );
    }
    console.log(`Seeded ${defaults.length} default policies.`);
  }

  const agentCount = db.prepare("SELECT COUNT(*) as c FROM agents").get().c;
  if (agentCount === 0) {
    const id = nanoid();
    const apiKey = "wd_" + nanoid(32);
    db.prepare(
      "INSERT INTO agents (id, name, api_key, status) VALUES (?, ?, ?, 'active')"
    ).run(id, "Demo Agent", apiKey);
    console.log(`Seeded demo agent with API key: ${apiKey}`);
  }
}

seed();
module.exports = seed;
