import { getConfig } from '../utils/config.js';

let pool: any = null;

export function getConnection() {
  if (!pool) {
    const config = getConfig();
    pool = { query: async (sql: string, params: any[]) => ({ rows: [] }) };
  }
  return pool;
}
