const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../db");
const { signToken } = require("../middleware/auth");

const router = express.Router();

router.post("/login", (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "Email and password required." });

  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  if (!user) return res.status(401).json({ error: "Invalid credentials." });

  const ok = bcrypt.compareSync(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: "Invalid credentials." });

  const token = signToken(user);
  res.json({ token, user: { id: user.id, email: user.email, role: user.role } });
});

module.exports = router;
