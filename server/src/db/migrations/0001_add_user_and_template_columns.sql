-- 0001: columns added after the initial schema.
-- These were previously applied by an ad-hoc ALTER loop in database.ts.
-- On databases created before the migration system existed (which already
-- have these columns), this migration is auto-baselined and never executed.
ALTER TABLE users ADD COLUMN kind TEXT NOT NULL DEFAULT 'wechat';
ALTER TABLE users ADD COLUMN image_storage TEXT NOT NULL DEFAULT 'local';
ALTER TABLE template_cells ADD COLUMN image_path TEXT DEFAULT '';
