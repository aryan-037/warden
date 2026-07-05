const express = require("express");
const { nanoid } = require("nanoid");
const db = require("../db");
const { requireDashboardAuth } = require("../middleware/auth");

const router = express.Router();

router.get("/", requireDashboardAuth, (req, res) => {
  const policies = db.prepare("SELECT * FROM policies ORDER BY created_at DESC").all();
  res.json({ policies });
});

router.post("/", requireDashboardAuth, (req, res) => {
  const {
    name, description, match_type, match_field, pattern, action_type_filter,
    decision, risk_weight, rate_limit_count, rate_limit_window_secs,
  } = req.body || {};

  if (!name || !match_type || !decision) {
    return res.status(400).json({ error: "name, match_type, and decision are required." });
  }
  const validMatchTypes = ["action_type", "target_regex", "param_regex", "rate_limit"];
  const validDecisions = ["block", "flag", "allow"];
  if (!validMatchTypes.includes(match_type)) return res.status(400).json({ error: "Invalid match_type." });
  if (!validDecisions.includes(decision)) return res.status(400).json({ error: "Invalid decision." });

  const id = nanoid();
  db.prepare(`
    INSERT INTO policies
      (id, name, description, match_type, match_field, pattern, action_type_filter, decision, risk_weight, enabled, rate_limit_count, rate_limit_window_secs)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(
    id, name, description || null, match_type, match_field || null, pattern || null, action_type_filter || null,
    decision, risk_weight || 10, rate_limit_count || null, rate_limit_window_secs || null
  );

  const policy = db.prepare("SELECT * FROM policies WHERE id = ?").get(id);
  res.status(201).json({ policy });
});

router.patch("/:id", requireDashboardAuth, (req, res) => {
  const existing = db.prepare("SELECT * FROM policies WHERE id = ?").get(req.params.id);
  if (!existing) return res.status(404).json({ error: "Policy not found." });

  const fields = [
    "name", "description", "match_type", "match_field", "pattern", "action_type_filter",
    "decision", "risk_weight", "enabled", "rate_limit_count", "rate_limit_window_secs",
  ];
  const updates = [];
  const args = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) {
      updates.push(`${f} = ?`);
      args.push(req.body[f]);
    }
  }
  if (updates.length === 0) return res.status(400).json({ error: "No fields to update." });

  args.push(req.params.id);
  db.prepare(`UPDATE policies SET ${updates.join(", ")} WHERE id = ?`).run(...args);

  const policy = db.prepare("SELECT * FROM policies WHERE id = ?").get(req.params.id);
  res.json({ policy });
});

router.delete("/:id", requireDashboardAuth, (req, res) => {
  db.prepare("DELETE FROM policies WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
