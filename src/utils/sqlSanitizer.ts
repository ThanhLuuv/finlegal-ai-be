// SQL Query Sanitizer & Read-Only Validator

export class SQLSanitizer {
  private static FORBIDDEN_KEYWORDS = [
    'INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'CREATE', 
    'TRUNCATE', 'REPLACE', 'ATTACH', 'DETACH', 'PRAGMA', 'TRANSACTION'
  ];

  /**
   * Validates if a raw SQL string is strictly a Read-Only SELECT query.
   * Throws an error if any data modification statement is detected.
   */
  public static validateReadOnlySelect(query: string): string {
    const cleaned = query.trim().replace(/;+$/, '');

    // Strip out markdown code fences if present (e.g., ```sql ... ```)
    const sanitized = cleaned
      .replace(/^```sql\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    const upperQuery = sanitized.toUpperCase();

    if (!upperQuery.startsWith('SELECT') && !upperQuery.startsWith('WITH')) {
      throw new Error('Security Violation: Only SELECT queries are permitted.');
    }

    for (const keyword of this.FORBIDDEN_KEYWORDS) {
      // Check for standalone forbidden SQL keywords
      const regex = new RegExp(`\\b${keyword}\\b`, 'i');
      if (regex.test(sanitized)) {
        throw new Error(`Security Violation: Forbidden keyword '${keyword}' detected in SQL query.`);
      }
    }

    return sanitized;
  }
}
