/**
 * One-off: DROP TABLE agent_prompt using DATABASE_URL from .env.local.
 * Run from services/agent: node scripts/drop-agent-prompt.cjs
 */

const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const envPath = path.join(__dirname, "..", ".env.local");
const envContent = fs.readFileSync(envPath, "utf8");
const match = envContent.match(/^DATABASE_URL=(.+)$/m);
const connectionString = match ? match[1].trim() : null;
if (!connectionString) {
  console.error("DATABASE_URL not found in", envPath);
  process.exit(1);
}

const pool = new Pool({ connectionString });

async function main() {
  await pool.query("DROP TABLE IF EXISTS agent_prompt");
  console.log("Dropped table agent_prompt.");
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
