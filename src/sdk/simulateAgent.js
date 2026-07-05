/**
 * Simulates an AI agent firing a mix of safe, flagged, and blocked actions
 * against a running Warden instance. Useful for demoing the live dashboard.
 *
 * Usage: WARDEN_URL=http://localhost:8080 WARDEN_API_KEY=wd_xxx node src/sdk/simulateAgent.js
 */
const WARDEN_URL = process.env.WARDEN_URL || "http://localhost:8080";
const API_KEY = process.env.WARDEN_API_KEY;

if (!API_KEY) {
  console.error("Set WARDEN_API_KEY env var to a valid agent API key before running.");
  process.exit(1);
}

const scenarios = [
  { actionType: "http_request", target: "api.internal/orders", params: { method: "GET" } },
  { actionType: "file_read", target: "/home/agent-workspace/report.csv", params: { path: "report.csv" } },
  { actionType: "db_query", target: "orders_db", params: { query: "SELECT * FROM orders LIMIT 10" } },
  { actionType: "shell_exec", target: "/tmp", params: { command: "rm -rf /var/log/*" } },
  { actionType: "file_read", target: "/etc/secrets/.env", params: { path: ".env" } },
  { actionType: "http_request", target: "unknown-tracker.ru/beacon", params: { method: "POST" } },
  { actionType: "purchase", target: "cloud-vendor-api", params: { amount: 899, currency: "USD" } },
  { actionType: "code_exec", target: "sandbox", params: { command: "import os; os.system('shutdown -h now')" } },
  { actionType: "file_write", target: "/home/agent-workspace/output.json", params: { bytes: 4096 } },
  { actionType: "http_request", target: "trusted-vendor.com/webhook", params: { method: "POST" } },
];

async function fireAction(scenario) {
  try {
    const res = await fetch(`${WARDEN_URL}/v1/actions/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify(scenario),
    });
    const data = await res.json();
    console.log(`[${data.decision?.toUpperCase() || "ERR"}] ${scenario.actionType} -> ${scenario.target} (risk: ${data.riskScore})`);
  } catch (e) {
    console.error("Request failed:", e.message);
  }
}

async function run() {
  console.log(`Simulating agent traffic against ${WARDEN_URL} ...`);
  for (let i = 0; i < 30; i++) {
    const scenario = scenarios[Math.floor(Math.random() * scenarios.length)];
    await fireAction(scenario);
    await new Promise((r) => setTimeout(r, 400 + Math.random() * 800));
  }
  console.log("Simulation complete.");
}

run();
