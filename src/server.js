require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const http = require("http");

require("./db/seed")(); // ensure default admin/policies/demo agent exist

const authRoutes = require("./routes/auth");
const actionRoutes = require("./routes/actions");
const agentRoutes = require("./routes/agents");
const policyRoutes = require("./routes/policies");
const hub = require("./ws/hub");

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/healthz", (req, res) => res.json({ ok: true, service: "warden", time: new Date().toISOString() }));

app.use("/api/auth", authRoutes);
app.use("/v1/actions", actionRoutes);
app.use("/api/agents", agentRoutes);
app.use("/api/policies", policyRoutes);

// Serve dashboard static files
app.use(express.static(path.join(__dirname, "public")));
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api") || req.path.startsWith("/v1") || req.path === "/healthz") return next();
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

hub.init(server);

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`Warden running on http://localhost:${PORT}`);
});
