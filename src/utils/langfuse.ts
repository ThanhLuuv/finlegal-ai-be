// Langfuse Telemetry & Tracing Helper Service

export class LangfuseLogger {
  private publicKey?: string;
  private secretKey?: string;
  private host: string;

  constructor(publicKey?: string, secretKey?: string, host = 'https://cloud.langfuse.com') {
    this.publicKey = publicKey;
    this.secretKey = secretKey;
    this.host = host;
  }

  /**
   * Logs execution telemetry trace asynchronously to Langfuse Cloud API.
   */
  public async logTrace(params: {
    traceId: string;
    sessionId: string;
    userPrompt: string;
    intent: string;
    thoughtSteps: any[];
    finalAnswer: string;
    latencyMs: number;
  }): Promise<void> {
    if (!this.publicKey || !this.secretKey) {
      // Telemetry disabled or keys not configured
      return;
    }

    try {
      const endpoint = `${this.host}/api/public/ingestion`;
      const authHeader = `Basic ${btoa(`${this.publicKey}:${this.secretKey}`)}`;

      const body = {
        batch: [
          {
            id: crypto.randomUUID(),
            type: 'trace-create',
            timestamp: new Date().toISOString(),
            body: {
              id: params.traceId,
              name: `FinLegal-Audit-${params.intent}`,
              sessionId: params.sessionId,
              input: { prompt: params.userPrompt },
              output: { answer: params.finalAnswer, thoughtProcess: params.thoughtSteps },
              metadata: { intent: params.intent, latencyMs: params.latencyMs }
            }
          }
        ]
      };

      await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authHeader
        },
        body: JSON.stringify(body)
      });
    } catch (err) {
      console.warn('Langfuse telemetry logging error:', err);
    }
  }
}
