// SQL Database Analytics Tool Agent

import { LLMProviderService } from '../../services/llm';
import { D1DatabaseService } from '../../services/d1';
import { MultiAgentState } from '../types';
import { DemoLimitError } from '../demoLimits';

export class SQLToolAgent {
  private llm: LLMProviderService;
  private d1Service: D1DatabaseService;

  constructor(llm: LLMProviderService, d1Service: D1DatabaseService) {
    this.llm = llm;
    this.d1Service = d1Service;
  }

  public async execute(state: MultiAgentState): Promise<MultiAgentState> {
    state.thoughtProcess.push({
      agent: 'SQL_AGENT',
      status: 'EXECUTING',
      thought: 'Phân tích và truy vấn dữ liệu kinh doanh từ D1 SQL Database...',
      timestamp: Date.now()
    });

    const schema = `TABLE sales_transactions (
  id INTEGER PRIMARY KEY,
  transaction_id TEXT,
  customer_name TEXT,
  contract_ref TEXT,
  quarter TEXT,
  revenue_usd REAL,
  status TEXT,
  transaction_date TEXT
)`;

    try {
      const sqlQuery = await this.llm.generateText([
        {
          role: 'system',
          content: `You are an expert SQLite Data Analyst. Given the database schema below, generate a 100% valid SELECT SQLite query to answer the user prompt.
DB SCHEMA:
${schema}

RULES:
1. Return ONLY the raw SQL query. No markdown wrapping, no explanation.
2. Read-only SELECT statements ONLY.`
        },
        { role: 'user', content: state.userPrompt }
      ], { task: 'PRIMARY_LLM' });

      const cleanQuery = (sqlQuery || '').replace(/```sql|```/g, '').trim();
      state.sqlQuery = cleanQuery;

      if (cleanQuery && cleanQuery.toUpperCase().startsWith('SELECT')) {
        const results = await this.d1Service.executeQuery(`SELECT * FROM (${cleanQuery.replace(/;\s*$/, '')}) LIMIT 21`);
        if (results.length > 20) throw new DemoLimitError('Truy vấn trả về quá nhiều dữ liệu cho bản demo. Hãy lọc theo hợp đồng, thời gian hoặc yêu cầu số liệu tổng hợp.');
        state.sqlResult = results;
        state.sqlData = results;

        state.thoughtProcess.push({
          agent: 'SQL_AGENT',
          status: 'DONE',
          thought: `Đã thực thi thành công câu lệnh SQL trên D1 (${results.length} bản ghi).`,
          timestamp: Date.now()
        });
      }
    } catch (err) {
      if (err instanceof DemoLimitError) throw err;
      const errorMsg = err instanceof Error ? err.message : String(err);
      state.thoughtProcess.push({
        agent: 'SQL_AGENT',
        status: 'ERROR',
        thought: `Truy vấn SQL D1 thất bại: ${errorMsg}`,
        timestamp: Date.now()
      });
    }

    return state;
  }
}
