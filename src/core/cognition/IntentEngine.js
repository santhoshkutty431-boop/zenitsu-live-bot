class IntentEngine {
  constructor(runtime) {
    this.runtime = runtime;
    this.logger = runtime.logger;
  }

  detectIntent(prompt) {
    const lower = prompt.toLowerCase();
    
    // Check for moderation inquiries (e.g., why was I muted, show my cases)
    const modKeywords = ['why was i', 'mute', 'ban', 'warn', 'kick', 'cases', 'my warnings', 'case history'];
    if (modKeywords.some(kw => lower.includes(kw))) {
      return { type: 'MODERATION_QUERY', confidence: 0.95 };
    }

    // Check for server-specific inquiries
    const serverKeywords = ['rule', 'ticket', 'faq', 'shop', 'open', 'buy', 'admin', 'mod', 'support', 'channel', 'role', 'owner'];
    if (serverKeywords.some(kw => lower.includes(kw))) {
      return { type: 'SERVER_QUERY', confidence: 0.90 };
    }

    // Check for workflow/automation builder keywords
    const workflowKeywords = ['workflow', 'automation', 'zapier', 'when a member joins', 'auto-role', 'trigger'];
    if (workflowKeywords.some(kw => lower.includes(kw))) {
      return { type: 'WORKFLOW_CONFIG', confidence: 0.85 };
    }

    return { type: 'GENERAL_AI', confidence: 1.0 };
  }
}

module.exports = IntentEngine;
