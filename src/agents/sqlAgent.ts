// Dynamic Text-to-SQL Agent (Cloudflare D1 Database Query Engine)

import { BaseAgent } from './base';
import { AgentRole, MultiAgentState } from './state';
import { LLMProviderService } from '../services/llm';
import { D1DatabaseService } from '../services/d1';

export class SQLToolAgent extends BaseAgent {
  public role: AgentRole = 'SQL_AGENT';
  private d1Service: D1DatabaseService;

  constructor(llm: LLMProviderService, d1Service: D1DatabaseService) {
    super(llm);
    this.d1Service = d1Service;
  }

  public async execute(state: MultiAgentState): Promise<MultiAgentState> {
    this.recordThought(state, 'Inspecting D1 Database schema dynamically to construct Text-to-SQL query...');

    // 1. Inspect dynamic D1 database schema at runtime
    const { textPrompt: schemaPrompt } = await this.d1Service.getDynamicSchemaPrompt();

    this.recordThought(state, 'Dynamic schema retrieved from D1 database.', { schema: schemaPrompt });

    // 2. Generate SELECT query via LLM
    const sqlGeneration = await this.llm.generateJSON<{
      sqlQuery: string;
      reasoning: string;
    }>([
      {
        role: 'system',
        content: `You are an expert SQL Data Analyst Agent for Cloudflare D1 (SQLite).
Generate a strict, read-only SELECT query to answer the user request.
${schemaPrompt}

RULES:
1. ONLY generate SELECT queries. NO UPDATE, INSERT, DELETE, DROP, or ALTER statements.
2. Use standard SQLite functions.
3. Return raw SQL without markdown code fences in JSON format:
{
  "sqlQuery": "SELECT ... FROM ... WHERE ...",
  "reasoning": "Explanation of query strategy"
}`
      },
      {
        role: 'user',
        content: state.userPrompt
      }
    ]);

    state.sqlQuery = sqlGeneration.sqlQuery;
    this.recordThought(state, `Generated Text-to-SQL query: ${sqlGeneration.sqlQuery}`, { sql: sqlGeneration.sqlQuery });

    // 3. Execute query on Cloudflare D1
    try {
      const results = await this.d1Service.executeQuery(sqlGeneration.sqlQuery);
      state.sqlResult = results;

      this.recordThought(
        state, 
        `SQL query executed successfully. Returned ${results.length} record(s).`, 
        { resultCount: results.length, rows: results }
      );
    } catch (queryErr) {
      const errorMsg = queryErr instanceof Error ? queryErr.message : String(queryErr);
      this.recordThought(state, `SQL Query Execution Error: ${errorMsg}`, { error: errorMsg });
      state.sqlResult = [];
    }

    return state;
  }
}
