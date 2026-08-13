// Cloudflare D1 Relational Database Service & Dynamic Schema Inspector

import { SQLSanitizer } from '../utils/sqlSanitizer';

export interface ColumnSchema {
  name: string;
  type: string;
  notNull: boolean;
  isPrimaryKey: boolean;
}

export interface TableSchema {
  tableName: string;
  columns: ColumnSchema[];
}

export class D1DatabaseService {
  private db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  /**
   * Dynamically inspects D1 database schema for business tables ONLY.
   * Excludes sensitive system tables (chat_logs, document_chunks, ip_rate_limits, document_records, document_sections).
   */
  public async getDynamicSchemaPrompt(): Promise<{ textPrompt: string; schemas: TableSchema[] }> {
    const sensitiveTables = ['chat_logs', 'document_chunks', 'ip_rate_limits', 'document_records', 'document_sections'];
    
    const masterQuery = `
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'
    `;
    const { results } = await this.db.prepare(masterQuery).all<{ name: string }>();

    const businessTables = (results || []).filter(r => !sensitiveTables.includes(r.name));

    if (businessTables.length === 0) {
      return {
        textPrompt: 'No business tables currently exist in database.',
        schemas: []
      };
    }

    const schemas: TableSchema[] = [];
    const promptLines: string[] = ['DYNAMIC DATABASE SCHEMA INSPECTION RESULT:'];

    for (const row of businessTables) {
      const tableName = row.name;
      const pragmaQuery = `PRAGMA table_info("${tableName}")`;
      const colResults = await this.db.prepare(pragmaQuery).all<{
        name: string;
        type: string;
        notnull: number;
        pk: number;
      }>();

      const columns: ColumnSchema[] = (colResults.results || []).map(c => ({
        name: c.name,
        type: c.type,
        notNull: c.notnull === 1,
        isPrimaryKey: c.pk === 1
      }));

      schemas.push({ tableName, columns });

      const colDefs = columns.map(c => `${c.name} (${c.type}${c.isPrimaryKey ? ' PRIMARY KEY' : ''})`).join(', ');
      promptLines.push(`TABLE ${tableName} [ ${colDefs} ]`);
    }

    return {
      textPrompt: promptLines.join('\n'),
      schemas
    };
  }

  /**
   * Executes a safe, read-only SELECT query against Cloudflare D1 with table access control.
   */
  public async executeQuery<T = Record<string, unknown>>(rawSql: string): Promise<T[]> {
    const sanitizedSql = SQLSanitizer.validateReadOnlySelect(rawSql);
    
    // Enforce system table protection
    const sensitiveTables = ['chat_logs', 'document_chunks', 'ip_rate_limits', 'document_records', 'document_sections'];
    for (const table of sensitiveTables) {
      const regex = new RegExp(`\\b${table}\\b`, 'i');
      if (regex.test(sanitizedSql)) {
        throw new Error(`SECURITY_ERROR: Truy vấn vào bảng hệ thống "${table}" bị từ chối.`);
      }
    }

    const statement = this.db.prepare(sanitizedSql);
    const { results } = await statement.all<T>();
    return results || [];
  }


  /**
   * Persists AI chat trace log into D1 Database `chat_logs` table.
   */
  public async saveChatLog(log: {
    sessionId: string;
    traceId: string;
    userPrompt: string;
    intent: string;
    thoughtProcess: string;
    finalResponse: string;
    riskLevel: string;
  }): Promise<void> {
    try {
      await this.db.prepare(
        `INSERT INTO chat_logs (session_id, trace_id, user_prompt, intent, thought_process, final_response, risk_level)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        log.sessionId,
        log.traceId,
        log.userPrompt,
        log.intent,
        log.thoughtProcess,
        log.finalResponse,
        log.riskLevel
      ).run();
    } catch (err) {
      console.warn('Failed to insert chat_log into D1:', err);
    }
  }
}
