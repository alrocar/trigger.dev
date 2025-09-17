/**
 * Map ClickHouse table names to Tinybird datasource names
 * This is used by the TinybirdClient to determine which datasource to write to
 *
 * IMPORTANT: Do NOT include the database prefix (e.g., "trigger_dev.") in the keys
 * The TinybirdClient will automatically strip the database prefix
 */
export const TINYBIRD_TABLE_MAPPING: Record<string, string> = {
  "task_runs_v2": "task_runs_v2",
  "raw_task_runs_payload_v1": "raw_task_runs_payload_v1",
  // Add more mappings as needed
};

/**
 * Helper function to get Tinybird datasource name from ClickHouse table name
 * This function strips the database prefix from the table name
 */
export function getTinybirdDatasource(clickhouseTable: string): string {
  // Remove database prefix if present
  const parts = clickhouseTable.split('.');
  const tableName = parts.length > 1 ? parts[parts.length - 1] : clickhouseTable;

  // Look up mapping or use table name directly
  return TINYBIRD_TABLE_MAPPING[tableName] || tableName;
}