-- Binwak Database Schema

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  openid          TEXT    NOT NULL UNIQUE,
  nickname        TEXT    DEFAULT NULL UNIQUE,
  kind            TEXT    NOT NULL DEFAULT 'wechat', -- wechat, system
  image_storage   TEXT    NOT NULL DEFAULT 'local',  -- local, cloud
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Bingo boards table
CREATE TABLE IF NOT EXISTS boards (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id               INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title                 TEXT    DEFAULT 'Binwak',
  grid_size             INTEGER DEFAULT 5,
  theme                 TEXT    DEFAULT 'mono',
  is_active             INTEGER DEFAULT 1,
  is_favorite          INTEGER DEFAULT 0,
  published_template_id INTEGER DEFAULT NULL REFERENCES templates(id) ON DELETE SET NULL,
  created_at            DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Cells table
CREATE TABLE IF NOT EXISTS cells (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  board_id          INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  position          INTEGER NOT NULL,
  title             TEXT    DEFAULT '',
  image_name        TEXT    DEFAULT '',  -- storage key (e.g. photos/u1/b2/xxx.jpg)
  illustration_path TEXT    DEFAULT '',  -- storage key (e.g. illustrations/u1/xxx.jpg), NOT a URL
  completed         INTEGER DEFAULT 0,
  completed_at      DATETIME,
  UNIQUE(board_id, position)
);

-- Word bank table
CREATE TABLE IF NOT EXISTS word_banks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  word       TEXT    NOT NULL,
  sort_order INTEGER DEFAULT 0,
  UNIQUE(user_id, word)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_boards_user      ON boards(user_id);
CREATE INDEX IF NOT EXISTS idx_boards_user_list ON boards(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_boards_user_updated ON boards(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_cells_board      ON cells(board_id);
CREATE INDEX IF NOT EXISTS idx_cells_board_completed ON cells(board_id, completed);
CREATE INDEX IF NOT EXISTS idx_wordbanks_user   ON word_banks(user_id);

-- Templates plaza table
CREATE TABLE IF NOT EXISTS templates (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT    NOT NULL,
  description TEXT    DEFAULT '',
  grid_size   INTEGER NOT NULL,
  category    TEXT    DEFAULT 'other',
  is_pinned   INTEGER DEFAULT 0,

  favorite_count  INTEGER DEFAULT 0,
  use_count   INTEGER DEFAULT 0,
  status      TEXT    DEFAULT 'active', -- active, hidden, deleted
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Template cells table (replaces the templates.cells JSON field)
CREATE TABLE IF NOT EXISTS template_cells (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL,
  title       TEXT    DEFAULT '',
  image_path  TEXT    DEFAULT '',
  UNIQUE(template_id, position)
);

CREATE INDEX IF NOT EXISTS idx_template_cells_template ON template_cells(template_id);

CREATE INDEX IF NOT EXISTS idx_templates_user     ON templates(user_id);
CREATE INDEX IF NOT EXISTS idx_templates_category ON templates(category);
CREATE INDEX IF NOT EXISTS idx_templates_pinned   ON templates(is_pinned);
-- Composite index for list query: status filter + sort by created_at/use_count
CREATE INDEX IF NOT EXISTS idx_templates_list     ON templates(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_templates_popular  ON templates(status, use_count DESC);

-- Template favorites table
CREATE TABLE IF NOT EXISTS template_favorites (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  template_id INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, template_id)
);

CREATE INDEX IF NOT EXISTS idx_template_favorites_template ON template_favorites(template_id);
CREATE INDEX IF NOT EXISTS idx_template_favorites_user ON template_favorites(user_id);

-- Template usage records table (used to dedupe use_count; multiple uses of the same template by one user count only once)
CREATE TABLE IF NOT EXISTS template_uses (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  template_id INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, template_id)
);

CREATE INDEX IF NOT EXISTS idx_template_uses_template ON template_uses(template_id);

-- Illustrations table
CREATE TABLE IF NOT EXISTS illustrations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  word        TEXT    NOT NULL,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  image_path  TEXT    NOT NULL,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(word, user_id)
);

CREATE INDEX IF NOT EXISTS idx_illustrations_user ON illustrations(user_id);
CREATE INDEX IF NOT EXISTS idx_illustrations_word ON illustrations(word);

-- ── Webhooks (for integrating with Agent / Bot / OpenClaw) ──

CREATE TABLE IF NOT EXISTS webhooks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  url         TEXT    NOT NULL,
  secret      TEXT,
  events      TEXT    NOT NULL DEFAULT '["*"]',
  description TEXT,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
