import path from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { requireConfiguredUrl, testDatabaseUrl } from "./testDatabase.js";

const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../drizzle");

// Creates the test database if missing and brings it to the current schema.
export default async function setup() {
  const configuredUrl = requireConfiguredUrl();
  const testUrl = testDatabaseUrl(configuredUrl);
  const name = new URL(testUrl).pathname.slice(1);

  const admin = postgres(configuredUrl, { max: 1 });
  try {
    const existing = await admin`select 1 from pg_database where datname = ${name}`;
    if (existing.length === 0) await admin.unsafe(`create database "${name.replace(/"/g, '""')}"`);
  } finally {
    await admin.end();
  }

  const client = postgres(testUrl, { max: 1 });
  try {
    await migrate(drizzle(client), { migrationsFolder });
    // Every run starts empty; test data is never expected to outlive a run.
    const tables = await client`
      select tablename from pg_tables where schemaname = 'public' and tablename not like '\_\_drizzle%'`;
    if (tables.length > 0) {
      const list = tables.map((row) => `"${String(row.tablename).replace(/"/g, '""')}"`).join(", ");
      await client.unsafe(`truncate table ${list} restart identity cascade`);
    }
  } finally {
    await client.end();
  }
}
