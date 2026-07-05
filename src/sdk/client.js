/**
 * Warden SDK — drop into any AI agent codebase to intercept tool calls
 * before they execute.
 *
 * Example:
 *   const Warden = require('./client');
 *   const warden = new Warden({ baseUrl: 'https://your-warden.example.com', apiKey: process.env.WARDEN_API_KEY });
 *
 *   const decision = await warden.check({
 *     actionType: 'shell_exec',
 *     target: '/tmp',
 *     params: { command: userSuppliedCommand },
 *   });
 *
 *   if (decision.decision === 'block') {
 *     throw new Error(`Blocked by Warden: ${decision.reason}`);
 *   }
 *   // proceed with the actual tool call
 */
class Warden {
  constructor({ baseUrl, apiKey }) {
    if (!baseUrl) throw new Error("Warden SDK: baseUrl is required.");
    if (!apiKey) throw new Error("Warden SDK: apiKey is required.");
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.apiKey = apiKey;
  }

  /**
   * Checks a proposed action against Warden's policies.
   * Returns { decision: 'allow'|'flag'|'block', riskScore, reason, matchedPolicies }
   * Fails safe: on network error, returns decision 'flag' with reason so the
   * caller can decide whether to proceed cautiously or halt.
   */
  async check({ actionType, target, params }) {
    try {
      const res = await fetch(`${this.baseUrl}/v1/actions/check`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({ actionType, target, params }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Warden responded with ${res.status}`);
      }
      return await res.json();
    } catch (e) {
      return {
        decision: "flag",
        riskScore: 50,
        reason: `Warden unreachable (${e.message}) — failing open with a flag. Review connectivity.`,
        matchedPolicies: [],
      };
    }
  }

  /** Convenience wrapper: runs fn() only if Warden allows or flags (not block). Throws on block. */
  async guard(action, fn) {
    const decision = await this.check(action);
    if (decision.decision === "block") {
      const err = new Error(`Action blocked by Warden: ${decision.reason}`);
      err.wardenDecision = decision;
      throw err;
    }
    return fn(decision);
  }
}

module.exports = Warden;
