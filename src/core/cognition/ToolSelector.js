class ToolSelector {
  constructor(runtime) {
    this.runtime = runtime;
    this.logger = runtime.logger;
    this.registry = new Map();
  }

  registerTool(name, toolConfig) {
    this.registry.set(name, toolConfig);
    this.logger.debug(`[TOOL REGISTRY] Tool registered: ${name} (${toolConfig.description})`);
  }

  selectTool(intentType, details = {}) {
    const matchedTools = [];

    if (intentType === 'MODERATION_QUERY') {
      if (this.registry.has('fetchCases')) {
        matchedTools.push(this.registry.get('fetchCases'));
      }
    }

    if (intentType === 'SERVER_QUERY') {
      if (this.registry.has('searchKnowledge')) {
        matchedTools.push(this.registry.get('searchKnowledge'));
      }
    }

    return matchedTools;
  }
}

module.exports = ToolSelector;
