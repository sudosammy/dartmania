const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3");
const { open } = require("sqlite");

const dbPath =
  process.env.DB_PATH ||
  path.join(__dirname, "..", "data", "dartmania.sqlite");

const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

let dbPromise = null;

async function getDb() {
  if (!dbPromise) {
    dbPromise = open({
      filename: dbPath,
      driver: sqlite3.Database
    });
  }
  return dbPromise;
}

const schema = `
CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  mode TEXT NOT NULL,
  format TEXT NOT NULL,
  rounds INTEGER NOT NULL,
  double_out INTEGER NOT NULL,
  current_player_index INTEGER NOT NULL,
  dart_index INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  finished_at TEXT,
  winner_snapshot TEXT
);

CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS game_players (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  order_index INTEGER NOT NULL,
  score INTEGER NOT NULL,
  round_count INTEGER NOT NULL,
  turn_start_score INTEGER NOT NULL,
  darts_thrown INTEGER NOT NULL,
  FOREIGN KEY(game_id) REFERENCES games(id),
  FOREIGN KEY(player_id) REFERENCES players(id)
);

CREATE TABLE IF NOT EXISTS turns (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  order_index INTEGER NOT NULL,
  dart_index INTEGER NOT NULL,
  segment TEXT NOT NULL,
  base_value INTEGER NOT NULL,
  multiplier INTEGER NOT NULL,
  score_delta INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(game_id) REFERENCES games(id),
  FOREIGN KEY(player_id) REFERENCES players(id)
);

CREATE TABLE IF NOT EXISTS cricket_marks (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  segment TEXT NOT NULL,
  marks INTEGER NOT NULL,
  points INTEGER NOT NULL,
  FOREIGN KEY(game_id) REFERENCES games(id),
  FOREIGN KEY(player_id) REFERENCES players(id)
);

CREATE TABLE IF NOT EXISTS history (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(game_id) REFERENCES games(id)
);
`;

async function ensureColumn(db, table, column, definition) {
  const columns = await db.all(`PRAGMA table_info(${table})`);
  const exists = columns.some((col) => col.name === column);
  if (!exists) {
    await db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

async function initDb() {
  const db = await getDb();
  await db.exec(schema);
  await ensureColumn(db, "turns", "is_bust", "INTEGER NOT NULL DEFAULT 0");
}

module.exports = { getDb, initDb };
