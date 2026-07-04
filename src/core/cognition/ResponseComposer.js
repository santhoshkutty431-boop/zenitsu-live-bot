class ResponseComposer {
  constructor(runtime) {
    this.runtime = runtime;
    this.logger = runtime.logger;
  }

  compose(rawResponse, confidence, citations = []) {
    let finalOutput = rawResponse;

    if (confidence >= 0.85) {
      // High confidence -> output directly
      return { response: finalOutput, confidence: 'HIGH', citations };
    } 
    
    if (confidence >= 0.60) {
      // Medium confidence -> append uncertainty notice
      finalOutput += `\n\n*⚠️ Notice: I am moderately confident in this response. If you notice any discrepancy, please verify with the staff.*`;
      return { response: finalOutput, confidence: 'MEDIUM', citations };
    }

    // Low confidence -> ask for clarification
    return {
      response: `⚠️ **Notice**: I do not have enough context or confidence to answer this accurately. Please rephrase your query or contact the server staff directly.`,
      confidence: 'LOW',
      citations
    };
  }
}

module.exports = ResponseComposer;
