import { requireConfiguredUrl, testDatabaseUrl } from "./testDatabase.js";

// Runs before each test file imports the app, so the db client connects to the
// test database.
process.env.DATABASE_URL = testDatabaseUrl(requireConfiguredUrl());
