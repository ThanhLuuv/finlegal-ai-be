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
   * Dynamically inspects D1 database schema from `sqlite_master` & `PRAGMA table_info`.
   * Returns a complete, dynamic text representation of all tables and columns for LLM prompts.
   */
  public async getDynamicSchemaPrompt(): Promise<{ textPrompt: string; schemas: TableSchema[] }> {
    // Exclude system internal tables
    const masterQuery = `
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'
    `;
    const { results } = await this.db.prepare(masterQuery).all<{ name: string }>();

    if (!results || results.length === 0) {
      return {
        textPrompt: 'No business tables currently exist in database.',
        schemas: []
      };
    }

    const schemas: TableSchema[] = [];
    const promptLines: string[] = ['DYNAMIC DATABASE SCHEMA INSPECTION RESULT:'];

    for (const row of results) {
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
   * Executes a safe, read-only SELECT query against Cloudflare D1.
   */
  public async executeQuery<T = Record<string, unknown>>(rawSql: string): Promise<T[]> {
    const sanitizedSql = SQLSanitizer.validateReadOnlySelect(rawSql);
    const statement = this.db.prepare(sanitizedSql);
    const { results } = await statement.all<T>();
    return results || [];
  }
}
