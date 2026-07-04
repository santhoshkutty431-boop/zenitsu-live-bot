const IntentEngine = require('../core/cognition/IntentEngine');
const PolicyEngine = require('../core/cognition/PolicyEngine');
const PlannerEngine = require('../core/cognition/PlannerEngine');
const ToolSelector = require('../core/cognition/ToolSelector');
const ExecutionEngine = require('../core/cognition/ExecutionEngine');
const VerificationEngine = require('../core/cognition/VerificationEngine');
const ResponseComposer = require('../core/cognition/ResponseComposer');

class CognitionEngine {
  constructor(runtime) {
    this.runtime = runtime;
    this.logger = runtime.logger;

    this.intentEngine = new IntentEngine(runtime);
    this.policyEngine = new PolicyEngine(runtime);
    this.plannerEngine = new PlannerEngine(runtime);
    this.toolSelector = new ToolSelector(runtime);
    this.executionEngine = new ExecutionEngine(runtime);
    this.verificationEngine = new VerificationEngine(runtime);
    this.responseComposer = new ResponseComposer(runtime);

    this.permService = null;
    this.knowledgeService = null;
    this.aiProvider = null;
  }

  async onInit() {
    this.logger.info('Initializing AI Cognition Engine (v5.0)...');
    this.permService = this.runtime.getService('PermissionEngine');
    this.knowledgeService = this.runtime.getService('KnowledgeEngine');
    this.aiProvider = this.runtime.getService('AIProviderManager');

    // Register primary core tools
    this.toolSelector.registerTool('searchKnowledge', {
      name: 'searchKnowledge',
      description: 'Searches Server Knowledge Base',
      handler: async (d) => {
        return this.knowledgeService.searchKnowledge(d.prompt, d.guildId, d.userId);
      }
    });

    this.toolSelector.registerTool('fetchCases', {
      name: 'fetchCases',
      description: 'Retrieves moderation case log history',
      handler: async (d) => {
        const db = this.runtime.getService('DatabaseManager').db;
        const cases = db.cases || [];
        return cases.filter(c => c.userId === d.userId).slice(-5);
      }
    });
  }

  async onShutdown() {
    this.logger.info('Shutting down Cognition Engine...');
  }

  async processRequest(userId, guildId, guild, prompt) {
    this.logger.info(`[COGNITION PIPELINE] Processing request: "${prompt}"`);

    // 1. Detect Intent
    const intent = this.intentEngine.detectIntent(prompt);

    // 2. Policy check
    const permRes = this.permService.resolvePermission(null, 'whoami', userId);
    const policy = this.policyEngine.verifyPolicy(permRes.tier, intent.type, { prompt });
    if (!policy.allowed) {
      return { response: policy.message || '❌ Access Denied' };
    }

    // 3. Generate Plan
    const plan = this.plannerEngine.generatePlan(intent.type, { prompt });

    // 4. Select Tools
    const tools = this.toolSelector.selectTool(intent.type, { prompt });

    // 5. Execute Tools
    let contextData = '';
    let citations = [];
    let modCasesText = '';

    if (tools.length > 0) {
      const execution = await this.executionEngine.executePlan(plan, tools, {
        prompt,
        guildId,
        userId,
        requiresApproval: policy.requiresApproval
      });

      if (execution.status === 'PENDING_APPROVAL') {
        return { response: '⚠️ **Approval Required**: This action changes server configuration. Waiting for Server Owner approval.' };
      }

      // Collect tool outputs
      const successResults = execution.results.filter(r => r.status === 'SUCCESS');
      for (const res of successResults) {
        if (res.tool === 'searchKnowledge') {
          const matches = res.output;
          if (matches.length > 0) {
            contextData = matches.map(m => `Category: ${m.category}\nContent: ${m.content}\nSource: ${m.citedSource}`).join('\n\n');
            citations = matches.map(m => m.citedSource);
          }
        }
        else if (res.tool === 'fetchCases') {
          const cases = res.output;
          if (cases.length > 0) {
            modCasesText = cases.map(c => `Case #${c.caseId}: ${c.type} by ${c.executorTag} for reason: "${c.reason}" (Date: ${c.timestamp})`).join('\n');
          }
        }
      }
    }

    // 6. Formulate AI prompt
    let systemPrompt = 
      `You are ZENITSU AI, a secure Clean-Architecture Platform Assistant.\n` +
      `Always detect the user's language automatically and reply in the same language they use.\n` +
      `If the user switches languages, switch with them. Only use English if you cannot determine the language.\n`;

    if (contextData) {
      systemPrompt += `You must answer using only the following server knowledge:\n${contextData}\n\n` +
                      `RULES:\n` +
                      `1. Cite the sources accurately in your response (e.g. "According to the Rules Channel (#rules)...").\n` +
                      `2. If the context does not answer the question, state that you do not know. Do not hallucinate.`;
    }

    if (modCasesText) {
      systemPrompt += `The user has the following moderation case history. Use it to answer their question:\n${modCasesText}\n`;
    }

    // Query AI Provider
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

    // 7. Verify Response (Self-Reflection Check)
    const verification = this.verificationEngine.verifyResponse(aiRes.response, permRes.tier);
    if (!verification.verified) {
      return {
        response: '❌ **Verification Check Failed**: I detected that the compiled response contains references or configurations you do not have permission to view. Request denied.'
      };
    }

    // 8. Compose Response with Confidence
    const finalResponse = this.responseComposer.compose(aiRes.response, intent.confidence, citations);
    return finalResponse;
  }
}

module.exports = CognitionEngine;
