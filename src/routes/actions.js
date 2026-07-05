const express = require("express");
const { nanoid } = require("nanoid");
const db = require("../db");
const { requireAgentAuth, requireDashboardAuth } = require("../middleware/auth");
const { evaluateAction } = require("../policies/engine");
const hub = require("../ws/hub");

const router = express.Router();

/**
 * POST /v1/actions/check
 * Called by an agent (via SDK) BEFORE it executes a tool call.
 * Body: { actionType, target, params }
 * Returns: { id, decision, riskScore, reason, matchedPolicies }
 */
router.post("/check", requireAgentAuth, (req, res) => {
  const { actionType, target, params } = req.body || {};
  if (!actionType) return res.status(400).json({ error: "actionType is required." });

  const result = evaluateAction({
    agentId: req.agent.id,
    actionType,
    target,
    params,
  });

  const id = nanoid();
  db.prepare(`
    INSERT INTO actions (id, agent_id, action_type, target, params_json, risk_score, decision, matched_policies_json, reason)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    req.agent.id,
    actionType,
    target || null,
    JSON.stringify(params || {}),
    result.riskScore,
    result.decision,
    JSON.stringify(result.matchedPolicies),
    result.reason
  );

  const record = db.prepare("SELECT * FROM actions WHERE id = ?").get(id);
  hub.broadcast("action", { ...record, agent_name: req.agent.name });

  res.json({
    id,
    decision: result.decision,
    riskScore: result.riskScore,
    reason: result.reason,
    matchedPolicies: result.matchedPolicies,
  });
});

/**
 * GET /v1/actions
 * Dashboard: paginated audit trail with optional filters.
 */
router.get("/", requireDashboardAuth, (req, res) => {
  const { decision, agentId, limit = 50, offset = 0 } = req.query;
  let query = `
    SELECT actions.*, agents.name as agent_name
    FROM actions
    JOIN agents ON agents.id = actions.agent_id
    WHERE 1=1
  `;
  const args = [];
  if (decision) {
    query += " AND actions.decision = ?";
    args.push(decision);
  }
  if (agentId) {
    query += " AND actions.agent_id = ?";
    args.push(agentId);
  }
  query += " ORDER BY actions.created_at DESC LIMIT ? OFFSET ?";
  args.push(Number(limit), Number(offset));

  const rows = db.prepare(query).all(...args);
  res.json({ actions: rows });
});

/**
 * GET /v1/actions/stats
 * Dashboard: summary counts for analytics widgets.
 */
router.get("/stats", requireDashboardAuth, (req, res) => {
  const totals = db.prepare(`
    SELECT decision, COUNT(*) as count FROM actions GROUP BY decision
  `).all();

  const last24h = db.prepare(`
    SELECT decision, COUNT(*) as count FROM actions
    WHERE created_at >= datetime('now', '-1 day')
    GROUP BY decision
  `).all();

  const topAgents = db.prepare(`
    SELECT agents.name, agents.id, COUNT(actions.id) as action_count,
      SUM(CASE WHEN actions.decision = 'block' THEN 1 ELSE 0 END) as blocked_count
    FROM agents
    LEFT JOIN actions ON actions.agent_id = agents.id
    GROUP BY agents.id
    ORDER BY action_count DESC
  `).all();

  const avgRisk = db.prepare(`SELECT AVG(risk_score) as avg FROM actions`).get();

  res.json({ totals, last24h, topAgents, avgRiskScore: avgRisk.avg || 0 });
});

module.exports = router;
