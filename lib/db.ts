import postgres from "postgres";

// Vercel functions are fresh processes per invocation, so keep the pool tiny —
// there's no benefit to holding a large connection pool across invocations.
let sql: ReturnType<typeof postgres> | null = null;

export function getDb() {
  if (!sql) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set");
    }
    sql = postgres(connectionString, { max: 1 });
  }
  return sql;
}
