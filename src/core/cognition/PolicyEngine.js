class PolicyEngine {
  constructor(runtime) {
    this.runtime = runtime;
    this.logger = runtime.logger;
  }

  verifyPolicy(userTier, actionType, details = {}) {
    // 1. Never expose hidden channels or private log channels to public users
    if (userTier === 'PUBLIC') {
      const privateKeywords = ['mod-log', 'server-logs', 'secret-staff', 'securityConfig', 'emergencyLock'];
      if (details.response) {
        const lowerRes = details.response.toLowerCase();
        const hasLeak = privateKeywords.some(kw => lowerRes.includes(kw));
        if (hasLeak) {
          this.logger.warn(`[POLICY GUARD] Blocked potential information leak to Public user.`);
          return { allowed: false, reason: 'POTENTIAL_LEAK', message: '❌ Response contained restricted keywords.' };
        }
      }
    }

    // 2. Enforce human approval for all destructive actions
    const destructiveActions = ['DELETE_CHANNEL', 'REVOKE_ROLE', 'MODIFY_PERMISSIONS', 'FLUSH_DATABASE'];
    if (destructiveActions.includes(actionType)) {
      return { allowed: true, requiresApproval: true, gate: 'OWNER_APPROVAL' };
    }

    return { allowed: true, requiresApproval: false };
  }
}

module.exports = PolicyEngine;
