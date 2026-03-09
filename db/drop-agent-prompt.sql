-- One-off migration: drop agent_prompt table.
-- The agent now uses services/agent/prompt.md; the dashboard Prompt tab was removed.
-- Run once against your existing DB: psql $DATABASE_URL -f db/drop-agent-prompt.sql

DROP TABLE IF EXISTS agent_prompt;
