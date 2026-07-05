const express = require("express");
const { nanoid } = require("nanoid");
const db = require("../db");
const { requireDashboardAuth } = require("../middleware/auth");

const router = express.Router();

router.get("/", requireDashboardAuth, (req, res) => {
  const agents = db.prepare("SELECT id, name, api_key, status, created_at, last_seen_at FROM agents ORDER BY created_at DESC").all();
  res.json({ agents });
});

router.post("/", requireDashboardAuth, (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: "name is required." });

  const id = nanoid();
  const apiKey = "wd_" + nanoid(32);
  db.prepare("INSERT INTO agents (id, name, api_key, status) VALUES (?, ?, ?, 'active')").run(id, name, apiKey);
  const agent = db.prepare("SELECT * FROM agents WHERE id = ?").get(id);
  res.status(201).json({ agent });
});

router.patch("/:id", requireDashboardAuth, (req, res) => {
  const { status, name } = req.body || {};
  const agent = db.prepare("SELECT * FROM agents WHERE id = ?").get(req.params.id);
  if (!agent) return res.status(404).json({ error: "Agent not found." });

  if (status) db.prepare("UPDATE agents SET status = ? WHERE id = ?").run(status, req.params.id);
  if (name) db.prepare("UPDATE agents SET name = ? WHERE id = ?").run(name, req.params.id);

  const updated = db.prepare("SELECT * FROM agents WHERE id = ?").get(req.params.id);
  res.json({ agent: updated });
});

router.post("/:id/rotate-key", requireDashboardAuth, (req, res) => {
  const agent = db.prepare("SELECT * FROM agents WHERE id = ?").get(req.params.id);
  if (!agent) return res.status(404).json({ error: "Agent not found." });

  const newKey = "wd_" + nanoid(32);
  db.prepare("UPDATE agents SET api_key = ? WHERE id = ?").run(newKey, req.params.id);
  res.json({ apiKey: newKey });
});

router.delete("/:id", requireDashboardAuth, (req, res) => {
  db.prepare("DELETE FROM actions WHERE agent_id = ?").run(req.params.id);
  db.prepare("DELETE FROM agents WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
