import { getConnection } from './connection.js';

export async function getUserById(id: string) {
  const db = getConnection();
  return db.query('SELECT * FROM users WHERE id = $1', [id]);
}

export async function createUser(data: { name: string; email: string }) {
  const db = getConnection();
  return db.query('INSERT INTO users (name, email) VALUES ($1, $2)', [data.name, data.email]);
}
