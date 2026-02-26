-- Writing Prompts table
CREATE TABLE IF NOT EXISTS writing_prompts (
    id SERIAL PRIMARY KEY,
    prompt_text TEXT NOT NULL,
    category TEXT DEFAULT 'general',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add prompt_id to journals for linking responses
ALTER TABLE journals ADD COLUMN IF NOT EXISTS prompt_id INTEGER
    REFERENCES writing_prompts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_journals_prompt_id
    ON journals(prompt_id) WHERE prompt_id IS NOT NULL;
