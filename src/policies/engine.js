const db = require("../db");

// In-memory sliding window tracker for rate-limit policies: agentId -> array of timestamps (ms)
const actionTimestamps = new Map();

function recordTimestamp(agentId) {
  const now = Date.now();
  const arr = actionTimestamps.get(agentId) || [];
  arr.push(now);
  // keep only last 5 minutes to bound memory
  const cutoff = now - 5 * 60 * 1000;
  actionTimestamps.set(agentId, arr.filter((t) => t > cutoff));
}

function countInWindow(agentId, windowSecs) {
  const now = Date.now();
  const arr = actionTimestamps.get(agentId) || [];
  const cutoff = now - windowSecs * 1000;
  return arr.filter((t) => t > cutoff).length;
}

function getEnabledPolicies() {
  return db.prepare("SELECT * FROM policies WHERE enabled = 1").all();
}

function safeRegexTest(pattern, str) {
  try {
    const re = new RegExp(pattern, "i");
    return re.test(str);
  } catch (e) {
    return false;
  }
}

/**
 * Evaluate a single action against all enabled policies.
 * action: { agentId, actionType, target, params (object) }
 * returns: { riskScore, decision, matchedPolicies: [{id, name, decision, risk_weight}], reason }
 */
function evaluateAction(action) {
  const { agentId, actionType, target, params } = action;
  const policies = getEnabledPolicies();
  const paramsStr = JSON.stringify(params || {});

  const matched = [];
  let riskScore = 0;
  let finalDecision = "allow";

  for (const policy of policies) {
    let isMatch = false;

    // If a policy is scoped to specific action types, skip evaluation entirely for non-matching types
    if (policy.action_type_filter) {
      const allowedTypes = policy.action_type_filter.split(",").map((t) => t.trim());
      if (!allowedTypes.includes(actionType)) continue;
    }

    switch (policy.match_type) {
      case "action_type":
        isMatch = policy.pattern && actionType === policy.pattern;
        break;

      case "target_regex":
        if (target) isMatch = safeRegexTest(policy.pattern, target);
        break;

      case "param_regex":
        if (policy.match_field === "*" || !policy.match_field) {
          isMatch = safeRegexTest(policy.pattern, paramsStr);
        } else if (params && params[policy.match_field] != null) {
          isMatch = safeRegexTest(policy.pattern, String(params[policy.match_field]));
        }
        break;

      case "rate_limit": {
        const count = countInWindow(agentId, policy.rate_limit_window_secs || 10);
        isMatch = count + 1 > (policy.rate_limit_count || 20);
        break;
      }

      default:
        isMatch = false;
    }

    if (isMatch) {
      matched.push({
        id: policy.id,
        name: policy.name,
        decision: policy.decision,
        risk_weight: policy.risk_weight,
      });
      riskScore += policy.risk_weight;

      // escalate final decision: block > flag > allow
      if (policy.decision === "block") finalDecision = "block";
      else if (policy.decision === "flag" && finalDecision !== "block") finalDecision = "flag";
    }
  }

  riskScore = Math.min(100, riskScore);
  recordTimestamp(agentId);

  const reason =
    matched.length > 0
      ? `Matched ${matched.length} policy(ies): ${matched.map((m) => m.name).join(", ")}`
      : "No policy matched — action allowed by default.";

  return { riskScore, decision: finalDecision, matchedPolicies: matched, reason };
}

module.exports = { evaluateAction };
