import "../src/env.js";

// Tests run against "<configured database>_test" on the same server, so they
// never write into the development data the app is used with.
export function testDatabaseUrl(configuredUrl: string): string {
  const url = new URL(configuredUrl);
  if (url.pathname.length <= 1) throw new Error("DATABASE_URL must name a database");
  url.pathname = `${url.pathname}_test`;
  return url.toString();
}

export function requireConfiguredUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return url;
}
