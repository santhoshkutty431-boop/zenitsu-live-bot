class CognitionEngine {
  constructor(runtime) {
    this.runtime = runtime;
    this.logger = runtime.logger;
    this.permService = null;
    this.knowledgeService = null;
    this.aiProvider = null;
  }

  async onInit() {
    this.logger.info('Initializing AI Cognition Engine (v4.0)...');
    this.permService = this.runtime.getService('PermissionEngine');
    this.knowledgeService = this.runtime.getService('KnowledgeEngine');
    this.aiProvider = this.runtime.getService('AIProviderManager');
  }

  async onShutdown() {
    this.logger.info('Shutting down Cognition Engine...');
  }

  async processRequest(userId, guildId, guild, prompt) {
    this.logger.info(`[COGNITION PIPELINE] Starting cognitive pipeline for prompt: "${prompt}"`);

    // 1. Intent Detection
    const isServerQuery = this.detectServerIntent(prompt);
    
    // 2. Permission Verification
    const permRes = this.permService.resolvePermission(null, 'whoami', userId);

    let contextData = '';
    let citations = [];

    // 3. Knowledge Retrieval (if server query)
    if (isServerQuery && guildId) {
      this.logger.info('[COGNITION PIPELINE] Server query intent identified. Searching Knowledge Engine...');
      const matches = await this.knowledgeService.searchKnowledge(prompt, guildId, userId);
      
      if (matches.length > 0) {
        contextData = matches.map(m => `Category: ${m.category}\nContent: ${m.content}\nSource: ${m.citedSource}`).join('\n\n');
        citations = matches.map(m => m.citedSource);
        this.logger.info(`[COGNITION PIPELINE] Retrieved ${matches.length} matching document(s) for context.`);
      } else {
        this.logger.warn('[COGNITION PIPELINE] No semantic match found in Knowledge Base.');
      }
    }

    // 4. Action Planning & Self-Verification (Reflection Loop)
    let systemPrompt = `You are ZENITSU AI. Reply directly and support the user.\n`;
    if (contextData) {
      systemPrompt += `You must answer using only the following server knowledge:\n${contextData}\n\n` +
                      `RULES:\n` +
                      `1. Cite the sources accurately in your response (e.g. "According to the Rules Channel (#rules)...").\n` +
                      `2. If the context does not answer the question, state that you do not know. Do not hallucinate.`;
    }

    const aiRes = await this.aiProvider.query(
      userId,
      prompt,
      'gemini',
      systemPrompt,
      [{ role: 'user', content: prompt }]
    );

    if (aiRes.error) {
      return aiRes;
    }

    // 5. Self-Reflection checks (Verification)
    const isSelfVerified = this.reflectAndVerify(aiRes.response, permRes.tier);
    if (!isSelfVerified) {
      return {
        response: '❌ **Verification Check Failed**: I detected that the compiled response contains references or configurations you do not have permission to view. Request denied.'
      };
    }

    return {
      response: aiRes.response,
      citations
    };
  }

  detectServerIntent(prompt) {
    const keywords = ['rule', 'ticket', 'faq', 'shop', 'open', 'buy', 'admin', 'mod', 'support', 'channel', 'role'];
    const lower = prompt.toLowerCase();
    return keywords.some(kw => lower.includes(kw));
  }

  reflectAndVerify(response, userTier) {
    const lowerResponse = response.toLowerCase();
    
    // Safety check: prevent leaking secret channels or configurations to public users
    if (userTier === 'PUBLIC') {
      const privateLeaks = ['mod-log', 'server-logs', 'secret-staff', 'securityConfig', 'emergencyLock'];
      const leaksDetected = privateLeaks.some(leak => lowerResponse.includes(leak.toLowerCase()));
      if (leaksDetected) {
        this.logger.warn(`[COGNITION REFLECTION] Blocked a potential leakage warning to Public user. Response contained restricted server keys.`);
        return false;
      }
    }
    return true;
  }
}

module.exports = CognitionEngine;
