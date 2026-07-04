class ExecutionEngine {
  constructor(runtime) {
    this.runtime = runtime;
    this.logger = runtime.logger;
  }

  async executePlan(plan, tools, details = {}) {
    const results = [];

    for (const tool of tools) {
      if (details.requiresApproval) {
        this.logger.info(`[EXECUTION ENGINE] Action requires approval. Halting execution for gate.`);
        return { status: 'PENDING_APPROVAL', plan, tools };
      }

      this.logger.info(`[EXECUTION ENGINE] Executing tool: ${tool.name}`);
      try {
        const res = await tool.handler(details);
        results.push({ tool: tool.name, status: 'SUCCESS', output: res });
      } catch (err) {
        this.logger.error(`[EXECUTION ENGINE] Tool execution failed: ${err.message}`);
        results.push({ tool: tool.name, status: 'FAILED', error: err.message });
      }
    }

    return { status: 'COMPLETED', results };
  }
}

module.exports = ExecutionEngine;
