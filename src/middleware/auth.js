const jwt = require("jsonwebtoken");
const db = require("../db");

const JWT_SECRET = process.env.JWT_SECRET || "warden-dev-secret-change-me";

function requireDashboardAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing auth token." });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (e) {
    return res.status(401).json({ error: "Invalid or expired token." });
  }
}

function requireAgentAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const apiKey = header.startsWith("Bearer ") ? header.slice(7) : req.headers["x-api-key"];
  if (!apiKey) return res.status(401).json({ error: "Missing API key." });

  const agent = db.prepare("SELECT * FROM agents WHERE api_key = ? AND status = 'active'").get(apiKey);
  if (!agent) return res.status(401).json({ error: "Invalid or inactive API key." });

  db.prepare("UPDATE agents SET last_seen_at = datetime('now') WHERE id = ?").run(agent.id);
  req.agent = agent;
  next();
}

function signToken(user) {
  return jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, {
    expiresIn: "12h",
  });
}

module.exports = { requireDashboardAuth, requireAgentAuth, signToken, JWT_SECRET };
