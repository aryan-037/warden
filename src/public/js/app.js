/* ===================== Warden Dashboard ===================== */
const state = {
  token: localStorage.getItem("warden_token") || null,
  user: JSON.parse(localStorage.getItem("warden_user") || "null"),
  route: "overview",
  agents: [],
  policies: [],
  stats: null,
  feed: [],
  ws: null,
};

const $app = document.getElementById("app");

/* ---------- API helper ---------- */
async function api(path, { method = "GET", body } = {}) {
  const hadToken = !!state.token;
  const res = await fetch(path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && hadToken) {
    // an authenticated request expired mid-session — force back to login
    logout();
    throw new Error("Session expired. Please log in again.");
  }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}


function logout() {
  state.token = null;
  state.user = null;
  localStorage.removeItem("warden_token");
  localStorage.removeItem("warden_user");
  if (state.ws) { state.ws.close(); state.ws = null; }
  render();
}

function toast(message, isError = false) {
  const el = document.createElement("div");
  el.className = "toast" + (isError ? " error" : "");
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function escapeHtml(str) {
  if (str == null) return "";
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function timeAgo(isoLike) {
  const d = new Date(isoLike.replace(" ", "T") + "Z");
  const diff = Math.max(0, Date.now() - d.getTime());
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/* ---------- Routing ---------- */
function navigate(route) {
  state.route = route;
  render();
}

/* ---------- Root render ---------- */
function render() {
  if (!state.token) {
    renderLogin();
  } else {
    renderShell();
  }
}

/* ---------- Login screen ---------- */
function renderLogin() {
  $app.innerHTML = `
    <div class="login-screen">
      <div class="login-card">
        <div class="login-logo">
          <div class="mark">W</div>
          <div class="word">WARDEN</div>
        </div>
        <div class="login-sub">AI Agent Security Platform</div>
        <form id="login-form">
          <div class="field">
            <label>Email</label>
            <input type="email" id="login-email" placeholder="admin@warden.local" required />
          </div>
          <div class="field">
            <label>Password</label>
            <input type="password" id="login-password" placeholder="••••••••" required />
          </div>
          <button type="submit" class="btn-primary">Sign in</button>
          <div class="login-error" id="login-error"></div>
        </form>
        <div class="login-hint">
          Default seed credentials: admin@warden.local / warden123<br/>
          Change these before deploying to production.
        </div>
      </div>
    </div>
  `;

  document.getElementById("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("login-email").value.trim();
    const password = document.getElementById("login-password").value;
    const errEl = document.getElementById("login-error");
    errEl.textContent = "";
    try {
      const data = await api("/api/auth/login", { method: "POST", body: { email, password } });
      state.token = data.token;
      state.user = data.user;
      localStorage.setItem("warden_token", data.token);
      localStorage.setItem("warden_user", JSON.stringify(data.user));
      state.route = "overview";
      render();
    } catch (err) {
      errEl.textContent = err.message;
    }
  });
}

/* ---------- App shell ---------- */
const NAV_ITEMS = [
  { key: "overview", label: "Overview" },
  { key: "agents", label: "Agents" },
  { key: "policies", label: "Policies" },
  { key: "audit", label: "Audit Log" },
  { key: "integrate", label: "Integrate" },
];

function renderShell() {
  $app.innerHTML = `
    <div class="shell">
      <div class="sidebar">
        <div class="brand-row">
          <div class="mark">W</div>
          <div class="word">WARDEN</div>
        </div>
        <div id="nav"></div>
        <div class="sidebar-footer">
          <div class="agent-status-line"><span class="pulse-dot"></span> LIVE FEED CONNECTED</div>
          <div class="agent-status-line" style="margin-bottom:14px;">${escapeHtml(state.user?.email || "")}</div>
          <button class="logout-btn" id="logout-btn">Sign out →</button>
        </div>
      </div>
      <div class="main" id="main"></div>
    </div>
  `;

  const nav = document.getElementById("nav");
  nav.innerHTML = NAV_ITEMS.map(
    (item) => `<div class="nav-item ${state.route === item.key ? "active" : ""}" data-route="${item.key}">
      <span class="dot"></span>${item.label}
    </div>`
  ).join("");
  nav.querySelectorAll(".nav-item").forEach((el) => {
    el.addEventListener("click", () => navigate(el.dataset.route));
  });

  document.getElementById("logout-btn").addEventListener("click", logout);

  connectWebSocket();
  renderPage();
}

function renderPage() {
  const main = document.getElementById("main");
  if (!main) return;
  switch (state.route) {
    case "overview": return renderOverview(main);
    case "agents": return renderAgents(main);
    case "policies": return renderPolicies(main);
    case "audit": return renderAudit(main);
    case "integrate": return renderIntegrate(main);
    default: return renderOverview(main);
  }
}

/* ---------- WebSocket live feed ---------- */
function connectWebSocket() {
  if (state.ws) return;
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onmessage = (evt) => {
    try {
      const msg = JSON.parse(evt.data);
      if (msg.type === "action") {
        state.feed.unshift(msg.payload);
        state.feed = state.feed.slice(0, 100);
        if (state.route === "overview") {
          renderFeedRows();
          refreshStats();
        }
      }
    } catch (e) { /* ignore */ }
  };
  ws.onclose = () => { state.ws = null; setTimeout(connectWebSocket, 3000); };
  state.ws = ws;
}

/* ---------- Overview page ---------- */
async function renderOverview(main) {
  main.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Overview</h1>
        <p class="page-sub">Real-time visibility into every action your AI agents attempt.</p>
      </div>
    </div>
    <div class="stat-grid" id="stat-grid"></div>
    <div class="two-col">
      <div class="panel">
        <div class="panel-header">
          <h3>Live Action Feed</h3>
          <span class="hint">Streaming via WebSocket</span>
        </div>
        <div class="feed" id="feed-container"></div>
      </div>
      <div class="panel">
        <div class="panel-header"><h3>Top Agents by Activity</h3></div>
        <div class="top-agents-list" id="top-agents"></div>
      </div>
    </div>
  `;

  try {
    const [actionsData, statsData] = await Promise.all([
      api("/v1/actions?limit=50"),
      api("/v1/actions/stats"),
    ]);
    state.feed = actionsData.actions;
    state.stats = statsData;
    renderStatGrid();
    renderFeedRows();
    renderTopAgents();
  } catch (e) {
    toast(e.message, true);
  }
}

async function refreshStats() {
  try {
    state.stats = await api("/v1/actions/stats");
    renderStatGrid();
    renderTopAgents();
  } catch (e) { /* silent */ }
}

function renderStatGrid() {
  const grid = document.getElementById("stat-grid");
  if (!grid) return;
  const totals = state.stats?.totals || [];
  const get = (d) => totals.find((t) => t.decision === d)?.count || 0;
  const total = totals.reduce((sum, t) => sum + t.count, 0);
  const avgRisk = Math.round(state.stats?.avgRiskScore || 0);

  grid.innerHTML = `
    <div class="stat-card"><div class="label">Total Actions</div><div class="value">${total}</div></div>
    <div class="stat-card allow"><div class="label">Allowed</div><div class="value">${get("allow")}</div></div>
    <div class="stat-card flag"><div class="label">Flagged</div><div class="value">${get("flag")}</div></div>
    <div class="stat-card block"><div class="label">Blocked</div><div class="value">${get("block")}</div></div>
  `;
}

function decisionBadge(decision) {
  return `<span class="decision-badge ${decision}">${decision}</span>`;
}

function renderFeedRows() {
  const container = document.getElementById("feed-container");
  if (!container) return;
  if (state.feed.length === 0) {
    container.innerHTML = `<div class="feed-empty">No actions yet. Run the demo simulator or connect an agent to see live traffic.</div>`;
    return;
  }
  container.innerHTML = state.feed
    .slice(0, 50)
    .map((a, i) => `
      <div class="feed-row ${i === 0 && a.decision === "block" ? "block-flash" : ""}">
        <div>${decisionBadge(a.decision)}</div>
        <div class="feed-agent">${escapeHtml(a.agent_name || "agent")}</div>
        <div class="feed-action">${escapeHtml(a.action_type)} <span class="target">→ ${escapeHtml(a.target || "—")}</span></div>
        <div class="feed-risk" style="color:${riskColor(a.risk_score)}">${a.risk_score}</div>
      </div>
    `)
    .join("");
}

function riskColor(score) {
  if (score >= 70) return "var(--block)";
  if (score >= 30) return "var(--flag)";
  return "var(--allow)";
}

function renderTopAgents() {
  const el = document.getElementById("top-agents");
  if (!el) return;
  const agents = state.stats?.topAgents || [];
  if (agents.length === 0) {
    el.innerHTML = `<div class="empty-state">No agents registered yet.</div>`;
    return;
  }
  el.innerHTML = agents
    .map(
      (a) => `<div class="top-agent-row">
        <span class="name">${escapeHtml(a.name)}</span>
        <span class="count">${a.action_count || 0} actions · ${a.blocked_count || 0} blocked</span>
      </div>`
    )
    .join("");
}

/* ---------- Agents page ---------- */
async function renderAgents(main) {
  main.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Agents</h1>
        <p class="page-sub">Manage the AI agents connected to Warden and their API keys.</p>
      </div>
      <button class="btn-add" id="add-agent-btn">+ New Agent</button>
    </div>
    <div class="panel">
      <table>
        <thead><tr><th>Name</th><th>API Key</th><th>Status</th><th>Last Seen</th><th></th></tr></thead>
        <tbody id="agents-tbody"></tbody>
      </table>
    </div>
  `;
  document.getElementById("add-agent-btn").addEventListener("click", showCreateAgentModal);
  await loadAgents();
}

async function loadAgents() {
  try {
    const data = await api("/api/agents");
    state.agents = data.agents;
    const tbody = document.getElementById("agents-tbody");
    if (!tbody) return;
    if (state.agents.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state">No agents yet. Create one to get an API key.</div></td></tr>`;
      return;
    }
    tbody.innerHTML = state.agents
      .map(
        (a) => `<tr>
          <td>${escapeHtml(a.name)}</td>
          <td><span class="key-chip">${escapeHtml(a.api_key)}</span></td>
          <td><span class="badge ${a.status === "active" ? "active" : "disabled"}">${a.status}</span></td>
          <td>${a.last_seen_at ? timeAgo(a.last_seen_at) : "never"}</td>
          <td style="text-align:right; white-space:nowrap;">
            <button class="icon-btn" data-action="toggle" data-id="${a.id}" data-status="${a.status}">${a.status === "active" ? "Disable" : "Enable"}</button>
            <button class="icon-btn" data-action="rotate" data-id="${a.id}">Rotate key</button>
            <button class="icon-btn danger" data-action="delete" data-id="${a.id}">Delete</button>
          </td>
        </tr>`
      )
      .join("");

    tbody.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => handleAgentAction(btn.dataset.action, btn.dataset.id, btn.dataset.status));
    });
  } catch (e) {
    toast(e.message, true);
  }
}

async function handleAgentAction(action, id, currentStatus) {
  try {
    if (action === "toggle") {
      await api(`/api/agents/${id}`, { method: "PATCH", body: { status: currentStatus === "active" ? "disabled" : "active" } });
      toast("Agent status updated.");
    } else if (action === "rotate") {
      const res = await api(`/api/agents/${id}/rotate-key`, { method: "POST" });
      toast(`New API key issued: ${res.apiKey}`);
    } else if (action === "delete") {
      if (!confirm("Delete this agent and all its logged actions? This can't be undone.")) return;
      await api(`/api/agents/${id}`, { method: "DELETE" });
      toast("Agent deleted.");
    }
    await loadAgents();
  } catch (e) {
    toast(e.message, true);
  }
}

function showCreateAgentModal() {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal">
      <h3>New Agent</h3>
      <div class="field">
        <label>Agent name</label>
        <input type="text" id="new-agent-name" placeholder="e.g. Support Bot, Deploy Agent" />
      </div>
      <div class="modal-actions">
        <button class="btn-secondary" id="cancel-agent">Cancel</button>
        <button class="btn-primary" id="confirm-agent">Create</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector("#cancel-agent").addEventListener("click", () => overlay.remove());
  overlay.querySelector("#confirm-agent").addEventListener("click", async () => {
    const name = document.getElementById("new-agent-name").value.trim();
    if (!name) return toast("Name is required.", true);
    try {
      await api("/api/agents", { method: "POST", body: { name } });
      overlay.remove();
      toast("Agent created.");
      await loadAgents();
    } catch (e) {
      toast(e.message, true);
    }
  });
}

/* ---------- Policies page ---------- */
async function renderPolicies(main) {
  main.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Policies</h1>
        <p class="page-sub">Rules that decide whether an agent action is allowed, flagged, or blocked.</p>
      </div>
      <button class="btn-add" id="add-policy-btn">+ New Policy</button>
    </div>
    <div class="panel">
      <table>
        <thead><tr><th>Name</th><th>Match Type</th><th>Action Types</th><th>Decision</th><th>Weight</th><th>Enabled</th><th></th></tr></thead>
        <tbody id="policies-tbody"></tbody>
      </table>
    </div>
  `;
  document.getElementById("add-policy-btn").addEventListener("click", () => showPolicyModal());
  await loadPolicies();
}

async function loadPolicies() {
  try {
    const data = await api("/api/policies");
    state.policies = data.policies;
    const tbody = document.getElementById("policies-tbody");
    if (!tbody) return;
    if (state.policies.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state">No policies configured. Every action will be allowed by default.</div></td></tr>`;
      return;
    }
    tbody.innerHTML = state.policies
      .map(
        (p) => `<tr>
          <td><strong>${escapeHtml(p.name)}</strong>${p.description ? `<div class="hint">${escapeHtml(p.description)}</div>` : ""}</td>
          <td class="mono" style="font-size:12px;">${p.match_type}</td>
          <td class="mono" style="font-size:12px; color:var(--text-muted);">${escapeHtml(p.action_type_filter || "any")}</td>
          <td><span class="badge ${p.decision}">${p.decision}</span></td>
          <td class="mono">${p.risk_weight}</td>
          <td><span class="badge ${p.enabled ? "active" : "disabled"}">${p.enabled ? "on" : "off"}</span></td>
          <td style="text-align:right; white-space:nowrap;">
            <button class="icon-btn" data-action="toggle" data-id="${p.id}" data-enabled="${p.enabled}">${p.enabled ? "Disable" : "Enable"}</button>
            <button class="icon-btn" data-action="edit" data-id="${p.id}">Edit</button>
            <button class="icon-btn danger" data-action="delete" data-id="${p.id}">Delete</button>
          </td>
        </tr>`
      )
      .join("");

    tbody.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => handlePolicyAction(btn.dataset.action, btn.dataset.id, btn.dataset.enabled));
    });
  } catch (e) {
    toast(e.message, true);
  }
}

async function handlePolicyAction(action, id, currentEnabled) {
  try {
    if (action === "toggle") {
      await api(`/api/policies/${id}`, { method: "PATCH", body: { enabled: currentEnabled === "1" ? 0 : 1 } });
      toast("Policy updated.");
      await loadPolicies();
    } else if (action === "delete") {
      if (!confirm("Delete this policy?")) return;
      await api(`/api/policies/${id}`, { method: "DELETE" });
      toast("Policy deleted.");
      await loadPolicies();
    } else if (action === "edit") {
      const policy = state.policies.find((p) => p.id === id);
      showPolicyModal(policy);
    }
  } catch (e) {
    toast(e.message, true);
  }
}

const MATCH_TYPE_HELP = {
  action_type: "Matches when the action's type exactly equals the pattern (e.g. 'shell_exec').",
  target_regex: "Matches when the action's target string matches this regex.",
  param_regex: "Matches when the given parameter field (or '*' for all params) matches this regex.",
  rate_limit: "Matches when an agent exceeds N actions within a time window.",
};

function showPolicyModal(policy = null) {
  const isEdit = !!policy;
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal">
      <h3>${isEdit ? "Edit Policy" : "New Policy"}</h3>
      <div class="field">
        <label>Name</label>
        <input type="text" id="p-name" value="${escapeHtml(policy?.name || "")}" placeholder="e.g. Block database drops" />
      </div>
      <div class="field">
        <label>Description (optional)</label>
        <input type="text" id="p-desc" value="${escapeHtml(policy?.description || "")}" placeholder="What does this catch and why?" />
      </div>
      <div class="field">
        <label>Match type</label>
        <select id="p-match-type">
          ${["action_type", "target_regex", "param_regex", "rate_limit"]
            .map((t) => `<option value="${t}" ${policy?.match_type === t ? "selected" : ""}>${t}</option>`)
            .join("")}
        </select>
        <div class="hint" id="match-type-help"></div>
      </div>
      <div id="dynamic-fields"></div>
      <div class="field">
        <label>Action types this applies to (comma-separated, blank = all)</label>
        <input type="text" id="p-action-filter" value="${escapeHtml(policy?.action_type_filter || "")}" placeholder="e.g. shell_exec,code_exec" />
      </div>
      <div class="field">
        <label>Decision</label>
        <select id="p-decision">
          ${["allow", "flag", "block"].map((d) => `<option value="${d}" ${policy?.decision === d ? "selected" : ""}>${d}</option>`).join("")}
        </select>
      </div>
      <div class="field">
        <label>Risk weight (0-100)</label>
        <input type="number" id="p-weight" min="0" max="100" value="${policy?.risk_weight ?? 20}" />
      </div>
      <div class="modal-actions">
        <button class="btn-secondary" id="cancel-policy">Cancel</button>
        <button class="btn-primary" id="confirm-policy">${isEdit ? "Save" : "Create"}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  function renderDynamicFields() {
    const matchType = document.getElementById("p-match-type").value;
    document.getElementById("match-type-help").textContent = MATCH_TYPE_HELP[matchType];
    const dyn = document.getElementById("dynamic-fields");
    if (matchType === "rate_limit") {
      dyn.innerHTML = `
        <div class="field"><label>Max actions allowed</label><input type="number" id="p-rl-count" value="${policy?.rate_limit_count ?? 20}" /></div>
        <div class="field"><label>Time window (seconds)</label><input type="number" id="p-rl-window" value="${policy?.rate_limit_window_secs ?? 10}" /></div>
      `;
    } else if (matchType === "action_type") {
      dyn.innerHTML = `<div class="field"><label>Action type to match exactly</label><input type="text" id="p-pattern" value="${escapeHtml(policy?.pattern || "")}" placeholder="shell_exec" /></div>`;
    } else if (matchType === "target_regex") {
      dyn.innerHTML = `<div class="field"><label>Regex pattern (matched against target)</label><input type="text" id="p-pattern" class="mono" value="${escapeHtml(policy?.pattern || "")}" placeholder="e.g. \\.env$" /></div>`;
    } else {
      dyn.innerHTML = `
        <div class="field"><label>Param field ('*' for all params)</label><input type="text" id="p-field" value="${escapeHtml(policy?.match_field || "*")}" /></div>
        <div class="field"><label>Regex pattern</label><input type="text" id="p-pattern" class="mono" value="${escapeHtml(policy?.pattern || "")}" placeholder="e.g. (secret|password)" /></div>
      `;
    }
  }
  renderDynamicFields();
  document.getElementById("p-match-type").addEventListener("change", renderDynamicFields);

  overlay.querySelector("#cancel-policy").addEventListener("click", () => overlay.remove());
  overlay.querySelector("#confirm-policy").addEventListener("click", async () => {
    const matchType = document.getElementById("p-match-type").value;
    const body = {
      name: document.getElementById("p-name").value.trim(),
      description: document.getElementById("p-desc").value.trim(),
      match_type: matchType,
      action_type_filter: document.getElementById("p-action-filter").value.trim() || null,
      decision: document.getElementById("p-decision").value,
      risk_weight: Number(document.getElementById("p-weight").value) || 0,
    };
    if (matchType === "rate_limit") {
      body.rate_limit_count = Number(document.getElementById("p-rl-count").value) || 20;
      body.rate_limit_window_secs = Number(document.getElementById("p-rl-window").value) || 10;
    } else {
      body.pattern = document.getElementById("p-pattern").value.trim();
      if (matchType === "param_regex") body.match_field = document.getElementById("p-field").value.trim() || "*";
    }
    if (!body.name) return toast("Name is required.", true);

    try {
      if (isEdit) {
        await api(`/api/policies/${policy.id}`, { method: "PATCH", body });
      } else {
        await api("/api/policies", { method: "POST", body });
      }
      overlay.remove();
      toast(isEdit ? "Policy updated." : "Policy created.");
      await loadPolicies();
    } catch (e) {
      toast(e.message, true);
    }
  });
}

/* ---------- Audit Log page ---------- */
async function renderAudit(main) {
  main.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Audit Log</h1>
        <p class="page-sub">Full, immutable history of every action Warden has evaluated.</p>
      </div>
    </div>
    <div class="panel">
      <div class="panel-header">
        <h3>Filters</h3>
        <div style="display:flex; gap:8px;">
          <select id="filter-decision">
            <option value="">All decisions</option>
            <option value="allow">Allow</option>
            <option value="flag">Flag</option>
            <option value="block">Block</option>
          </select>
          <select id="filter-agent">
            <option value="">All agents</option>
          </select>
        </div>
      </div>
      <table>
        <thead><tr><th>Time</th><th>Agent</th><th>Action</th><th>Target</th><th>Decision</th><th>Risk</th><th>Reason</th></tr></thead>
        <tbody id="audit-tbody"></tbody>
      </table>
    </div>
  `;

  try {
    const agentsData = await api("/api/agents");
    const sel = document.getElementById("filter-agent");
    sel.innerHTML += agentsData.agents.map((a) => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join("");
  } catch (e) { /* ignore */ }

  async function load() {
    const decision = document.getElementById("filter-decision").value;
    const agentId = document.getElementById("filter-agent").value;
    const params = new URLSearchParams({ limit: "100" });
    if (decision) params.set("decision", decision);
    if (agentId) params.set("agentId", agentId);
    try {
      const data = await api(`/v1/actions?${params.toString()}`);
      const tbody = document.getElementById("audit-tbody");
      if (data.actions.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state">No matching actions.</div></td></tr>`;
        return;
      }
      tbody.innerHTML = data.actions
        .map(
          (a) => `<tr>
            <td class="mono" style="font-size:12px; color:var(--text-muted);">${timeAgo(a.created_at)}</td>
            <td>${escapeHtml(a.agent_name)}</td>
            <td class="mono" style="font-size:12.5px;">${escapeHtml(a.action_type)}</td>
            <td class="mono" style="font-size:12px; color:var(--text-muted); max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(a.target || "—")}</td>
            <td>${decisionBadge(a.decision)}</td>
            <td class="mono" style="color:${riskColor(a.risk_score)}">${a.risk_score}</td>
            <td style="font-size:12px; color:var(--text-muted); max-width:220px;">${escapeHtml(a.reason)}</td>
          </tr>`
        )
        .join("");
    } catch (e) {
      toast(e.message, true);
    }
  }

  document.getElementById("filter-decision").addEventListener("change", load);
  document.getElementById("filter-agent").addEventListener("change", load);
  await load();
}

/* ---------- Integrate page ---------- */
function renderIntegrate(main) {
  const key = state.agents[0]?.api_key || "wd_your_agent_api_key";
  const origin = location.origin;
  main.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Integrate</h1>
        <p class="page-sub">Wire your AI agent up to Warden's interceptor in a few lines.</p>
      </div>
    </div>
    <div class="panel" style="padding:20px 24px;">
      <h3 style="margin-top:0;">1. Create an agent</h3>
      <p class="hint">Go to <a href="#" data-nav="agents">Agents</a> and create one — you'll get an API key like <span class="key-chip">wd_...</span>.</p>

      <h3>2. Call Warden before your agent executes a tool</h3>
      <pre class="mono" style="background:var(--bg-base); border:1px solid var(--border); border-radius:8px; padding:16px; overflow-x:auto; font-size:12.5px; line-height:1.6;">const Warden = require('./sdk/client');
const warden = new Warden({
  baseUrl: '${origin}',
  apiKey: process.env.WARDEN_API_KEY, // e.g. ${key}
});

const decision = await warden.check({
  actionType: 'shell_exec',
  target: '/tmp',
  params: { command: userSuppliedCommand },
});

if (decision.decision === 'block') {
  throw new Error('Blocked by Warden: ' + decision.reason);
}
// otherwise, proceed with the actual tool call</pre>

      <h3>3. Or use the guard() convenience wrapper</h3>
      <pre class="mono" style="background:var(--bg-base); border:1px solid var(--border); border-radius:8px; padding:16px; overflow-x:auto; font-size:12.5px; line-height:1.6;">await warden.guard(
  { actionType: 'file_write', target: path, params: { bytes: data.length } },
  async () => fs.writeFileSync(path, data) // only runs if not blocked
);</pre>

      <h3>Try it now with the demo simulator</h3>
      <p class="hint">From the project root, run:</p>
      <pre class="mono" style="background:var(--bg-base); border:1px solid var(--border); border-radius:8px; padding:16px; overflow-x:auto; font-size:12.5px;">WARDEN_URL=${origin} WARDEN_API_KEY=${key} node src/sdk/simulateAgent.js</pre>
      <p class="hint">Then watch the Overview page — actions will stream in live.</p>
    </div>
  `;
  main.querySelectorAll("[data-nav]").forEach((el) => el.addEventListener("click", (e) => { e.preventDefault(); navigate(el.dataset.nav); }));
}

/* ---------- Init ---------- */
render();
