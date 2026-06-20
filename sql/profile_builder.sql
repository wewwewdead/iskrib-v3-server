-- Profile Builder V1
-- Adds a versioned, controlled theme config for the profile builder.
-- Existing profiles (background, profile_font_color, dominant_colors,
-- secondary_colors) keep working; profile_theme is additive and may be null.

ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_theme jsonb;
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_theme_updated_at timestamptz;

-- profile_theme stays null for existing users so they render via the legacy
-- fallback path. No backfill required.
