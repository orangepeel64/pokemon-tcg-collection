const express = require('express');
const cors = require('cors');
const compression = require('compression');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { spawn } = require('child_process');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(compression());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'client/public')));

const DB_PATH = process.env.NODE_ENV === 'production' ? '/data/pokemon.db' : './pokemon.db';
const db = new sqlite3.Database(DB_PATH);

// ── Helpers ──
function dbGet(sql, params) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => { if (err) reject(err); else resolve(row); });
  });
}
function dbAll(sql, params) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => { if (err) reject(err); else resolve(rows || []); });
  });
}

// ── Schema bootstrap (non-destructive) ──
db.serialize(() => {
  const tables = [
    `CREATE TABLE IF NOT EXISTS series (id TEXT PRIMARY KEY, name TEXT NOT NULL, language TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS sets (id TEXT PRIMARY KEY, name TEXT NOT NULL, series_id TEXT, language TEXT NOT NULL, logo TEXT, symbol TEXT, card_count INTEGER DEFAULT 0, release_date TEXT)`,
    `CREATE TABLE IF NOT EXISTS cards (id TEXT NOT NULL, local_id TEXT NOT NULL, name TEXT NOT NULL, set_id TEXT NOT NULL, language TEXT NOT NULL, category TEXT, illustrator TEXT, rarity TEXT, image_url TEXT, image_hi TEXT, hp INTEGER, types TEXT, stage TEXT, evolve_from TEXT, suffix TEXT, retreat TEXT, description TEXT, effect TEXT, level TEXT, regulation TEXT, legal_std INTEGER DEFAULT 0, legal_expanded INTEGER DEFAULT 0, variants TEXT, attacks TEXT, abilities TEXT, weaknesses TEXT, resistances TEXT, pricing TEXT, PRIMARY KEY (id, language))`,
    `CREATE TABLE IF NOT EXISTS card_attacks (id INTEGER PRIMARY KEY AUTOINCREMENT, card_id TEXT NOT NULL, language TEXT NOT NULL, name TEXT, cost TEXT, damage TEXT, effect TEXT)`,
    `CREATE TABLE IF NOT EXISTS card_abilities (id INTEGER PRIMARY KEY AUTOINCREMENT, card_id TEXT NOT NULL, language TEXT NOT NULL, name TEXT, effect TEXT, type TEXT)`,
    `CREATE TABLE IF NOT EXISTS card_weaknesses (id INTEGER PRIMARY KEY AUTOINCREMENT, card_id TEXT NOT NULL, language TEXT NOT NULL, type TEXT, value TEXT)`,
    `CREATE TABLE IF NOT EXISTS card_resistances (id INTEGER PRIMARY KEY AUTOINCREMENT, card_id TEXT NOT NULL, language TEXT NOT NULL, type TEXT, value TEXT)`,
    `CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, is_admin INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS collection (id INTEGER PRIMARY KEY AUTOINCREMENT, card_id TEXT, user_id INTEGER DEFAULT 1, quantity INTEGER DEFAULT 1, condition TEXT DEFAULT 'Near Mint', language TEXT DEFAULT 'en', date_added TEXT DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS friends (user_id INTEGER NOT NULL, friend_id INTEGER NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (user_id, friend_id))`,
  ];
  tables.forEach(s => db.run(s));

  // Create indexes if not exist
  ['set_id', 'language', 'name', 'rarity', 'category', 'stage'].forEach(col => {
    db.run(`CREATE INDEX IF NOT EXISTS idx_cards_${col} ON cards(${col})`);
  });
});

// ── Auto-seed if empty ──
db.get("SELECT COUNT(*) as c FROM cards", async (err, row) => {
  if (err || !row || row.c === 0) {
    console.log('Database empty — running seed...');
    await new Promise((resolve, reject) => {
      const proc = spawn('node', ['seed.js'], {
        cwd: __dirname,
        env: { ...process.env, LANGUAGES: process.env.LANGUAGES || 'en,ja' }
      });
      proc.stdout.on('data', d => process.stdout.write(d));
      proc.stderr.on('data', d => process.stderr.write(d));
      proc.on('close', code => code === 0 ? resolve() : reject(new Error(`Seed exited ${code}`)));
    }).catch(e => { console.error('Seed failed:', e); process.exit(1); });
    console.log('Seed complete');
  } else {
    console.log(`Database ready — ${row.c} cards`);
  }
});

// ── Auth middleware ──
function authMW(req, res, next) {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) return res.status(401).json({ error: 'Auth required' });
  db.get("SELECT user_id FROM sessions WHERE token = ?", [h.slice(7)], (err, row) => {
    if (err || !row) return res.status(401).json({ error: 'Invalid token' });
    req.userId = row.user_id;
    next();
  });
}

function adminMW(req, res, next) {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) return res.status(401).json({ error: 'Auth required' });
  db.get("SELECT user_id FROM sessions WHERE token = ?", [h.slice(7)], (err, row) => {
    if (err || !row) return res.status(401).json({ error: 'Invalid token' });
    db.get("SELECT is_admin FROM users WHERE id = ?", [row.user_id], (err, user) => {
      if (err || !user || !user.is_admin) return res.status(403).json({ error: 'Admin required' });
      req.userId = row.user_id;
      next();
    });
  });
}

// ── Card serializer ──
function serializeCard(r) {
  return {
    id: r.id,
    localId: r.local_id,
    name: r.name,
    setId: r.set_id,
    language: r.language,
    category: r.category,
    illustrator: r.illustrator,
    rarity: r.rarity,
    image: r.image_url,
    imageHigh: r.image_hi,
    hp: r.hp,
    types: r.types ? JSON.parse(r.types) : null,
    stage: r.stage,
    evolveFrom: r.evolve_from,
    suffix: r.suffix,
    retreat: r.retreat,
    description: r.description,
    effect: r.effect,
    level: r.level,
    regulationMark: r.regulation,
    legal: { standard: !!r.legal_std, expanded: !!r.legal_exp },
    variants: r.variants ? JSON.parse(r.variants) : null,
    attacks: r.attacks ? JSON.parse(r.attacks) : null,
    abilities: r.abilities ? JSON.parse(r.abilities) : null,
    weaknesses: r.weaknesses ? JSON.parse(r.weaknesses) : null,
    resistances: r.resistances ? JSON.parse(r.resistances) : null,
    pricing: r.pricing ? JSON.parse(r.pricing) : null,
    set: r.set_name ? { id: r.set_id, name: r.set_name, logo: r.set_logo } : null,
  };
}

// ── API: Cards list ──
app.get('/api/cards', async (req, res) => {
  try {
    const lang = req.query.language || 'en';
    const {
      set, category, type, rarity, stage, search,
      sortBy = 'name', sortDir = 'asc',
      limit = 48, offset = 0
    } = req.query;

    let sql = `SELECT c.*, s.name as set_name, s.logo as set_logo
               FROM cards c LEFT JOIN sets s ON c.set_id = s.id AND c.language = s.language
               WHERE c.language = ?`;
    const params = [lang];

    if (set) { sql += ` AND c.set_id = ?`; params.push(set); }
    if (category) { sql += ` AND c.category = ?`; params.push(category); }
    if (rarity) { sql += ` AND c.rarity = ?`; params.push(rarity); }
    if (stage) { sql += ` AND c.stage = ?`; params.push(stage); }
    if (type) { sql += ` AND c.types LIKE ?`; params.push(`%"${type}"%`); }

    if (search) {
      const s = `%${search}%`;
      sql += ` AND (c.name LIKE ? OR c.id LIKE ? OR c.evolve_from LIKE ? OR c.description LIKE ? OR c.illustrator LIKE ? OR c.rarity LIKE ? OR c.local_id LIKE ?)`;
      params.push(s, s, s, s, s, s, s);
    }

    // Sorting
    const dir = sortDir.toLowerCase() === 'desc' ? 'DESC' : 'ASC';
    const sortMap = {
      name: 'c.name', number: 'CAST(c.local_id AS INTEGER)',
      hp: 'COALESCE(c.hp, 0)', rarity: 'c.rarity',
      set: 's.name', date: 's.release_date',
      random: 'RANDOM()'
    };
    const col = sortMap[sortBy] || 'c.name';
    sql += ` ORDER BY ${col} ${dir}`;
    sql += ` LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), parseInt(offset));

    const rows = await dbAll(sql, params);
    res.json(rows.map(serializeCard));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── API: Cards count ──
app.get('/api/cards/count', async (req, res) => {
  try {
    const lang = req.query.language || 'en';
    const { set, category, type, rarity, stage, search } = req.query;

    let sql = `SELECT COUNT(*) as count FROM cards WHERE language = ?`;
    const params = [lang];

    if (set) { sql += ` AND set_id = ?`; params.push(set); }
    if (category) { sql += ` AND category = ?`; params.push(category); }
    if (rarity) { sql += ` AND rarity = ?`; params.push(rarity); }
    if (stage) { sql += ` AND stage = ?`; params.push(stage); }
    if (type) { sql += ` AND types LIKE ?`; params.push(`%"${type}"%`); }

    if (search) {
      const s = `%${search}%`;
      sql += ` AND (name LIKE ? OR id LIKE ? OR evolve_from LIKE ? OR description LIKE ? OR illustrator LIKE ? OR rarity LIKE ? OR local_id LIKE ?)`;
      params.push(s, s, s, s, s, s, s);
    }

    const row = await dbGet(sql, params);
    res.json({ count: row?.count || 0 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── API: Single card ──
app.get('/api/cards/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const lang = req.query.language || 'en';

    const row = await dbGet(
      `SELECT c.*, s.name as set_name, s.logo as set_logo
       FROM cards c LEFT JOIN sets s ON c.set_id = s.id AND c.language = s.language
       WHERE c.id = ? AND c.language = ?`,
      [id, lang]
    );
    if (!row) return res.status(404).json({ error: 'Card not found' });

    const card = serializeCard(row);

    // Also fetch from other language if available
    const otherLang = lang === 'en' ? 'ja' : 'en';
    const otherRow = await dbGet(
      `SELECT c.*, s.name as set_name FROM cards c LEFT JOIN sets s ON c.set_id = s.id AND c.language = s.language
       WHERE c.id = ? AND c.language = ?`,
      [id, otherLang]
    );
    if (otherRow) {
      card.translation = {
        language: otherLang,
        name: otherRow.name,
        image: otherRow.image_url,
      };
    }

    res.json(card);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── API: Sets (language-aware) ──
app.get('/api/sets', async (req, res) => {
  try {
    const lang = req.query.language || 'en';
    const rows = await dbAll(
      `SELECT s.*, COUNT(c.id) as card_count
       FROM sets s LEFT JOIN cards c ON c.set_id = s.id AND c.language = ?
       WHERE s.language = ? GROUP BY s.id ORDER BY s.release_date DESC NULLS LAST, s.name ASC`,
      [lang, lang]
    );
    res.json(rows.map(r => ({
      id: r.id,
      name: r.name,
      seriesId: r.series_id,
      logo: r.logo,
      symbol: r.symbol,
      cardCount: r.card_count,
      releaseDate: r.release_date,
      language: r.language,
    })));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── API: Series ──
app.get('/api/series', async (req, res) => {
  try {
    const lang = req.query.language || 'en';
    const rows = await dbAll(
      `SELECT s.*, COUNT(DISTINCT st.id) as set_count
       FROM series s LEFT JOIN sets st ON st.series_id = s.id AND st.language = ?
       WHERE s.language = ? GROUP BY s.id ORDER BY s.name`,
      [lang, lang]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── API: Filter options ──
app.get('/api/filters', async (req, res) => {
  try {
    const lang = req.query.language || 'en';

    const [rarities, categories, stages, typesRows] = await Promise.all([
      dbAll("SELECT DISTINCT rarity as val FROM cards WHERE language = ? AND rarity IS NOT NULL ORDER BY rarity", [lang]),
      dbAll("SELECT DISTINCT category as val FROM cards WHERE language = ? AND category IS NOT NULL ORDER BY category", [lang]),
      dbAll("SELECT DISTINCT stage as val FROM cards WHERE language = ? AND stage IS NOT NULL ORDER BY stage", [lang]),
      dbAll("SELECT DISTINCT types FROM cards WHERE language = ? AND types IS NOT NULL", [lang]),
    ]);

    const typeSet = new Set();
    typesRows.forEach(r => {
      try { JSON.parse(r.types).forEach(t => typeSet.add(t)); } catch {}
    });

    res.json({
      rarities: rarities.map(r => r.val).filter(Boolean).sort(),
      categories: categories.map(r => r.val).filter(Boolean).sort(),
      stages: stages.map(r => r.val).filter(Boolean).sort(),
      types: [...typeSet].sort(),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Auth routes ──
app.post('/api/auth/signup', (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) return res.status(400).json({ error: 'All fields required' });
  db.run("INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)",
    [username, email, bcrypt.hashSync(password, 10)],
    function (err) {
      if (err) {
        if (err.message.includes('UNIQUE')) return res.status(409).json({ error: 'Username or email taken' });
        return res.status(500).json({ error: err.message });
      }
      const token = crypto.randomBytes(32).toString('hex');
      db.run("INSERT INTO sessions (token, user_id) VALUES (?, ?)", [token, this.lastID], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.status(201).json({ token, user: { id: this.lastID, username, email } });
      });
    });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  db.get("SELECT * FROM users WHERE username = ?", [username], (err, user) => {
    if (err || !user || !bcrypt.compareSync(password, user.password_hash))
      return res.status(401).json({ error: 'Invalid credentials' });
    const token = crypto.randomBytes(32).toString('hex');
    db.run("INSERT INTO sessions (token, user_id) VALUES (?, ?)", [token, user.id], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ token, user: { id: user.id, username: user.username, email: user.email } });
    });
  });
});

app.get('/api/auth/me', authMW, (req, res) => {
  db.get("SELECT id, username, is_admin FROM users WHERE id = ?", [req.userId], (err, user) => {
    if (!user) return res.status(404).json({ error: 'Not found' });
    res.json({ id: user.id, username: user.username, is_admin: !!user.is_admin });
  });
});

app.post('/api/auth/logout', authMW, (req, res) => {
  db.run("DELETE FROM sessions WHERE token = ?", [req.headers.authorization.slice(7)], () => res.json({ success: true }));
});

// ── Collection routes ──
app.get('/api/collection', authMW, async (req, res) => {
  try {
    const rows = await dbAll(
      `SELECT col.*, c.name, c.image_url, c.set_id, c.local_id, c.rarity, c.types, c.hp, c.category, c.stage, c.language as card_lang
       FROM collection col JOIN cards c ON col.card_id = c.id AND col.language = c.language
       WHERE col.user_id = ? ORDER BY col.date_added DESC`,
      [req.userId]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/collection/value', authMW, (req, res) => {
  db.get("SELECT COUNT(*) as totalCards, COALESCE(SUM(quantity),0) as totalQuantity FROM collection WHERE user_id = ?",
    [req.userId],
    (err, row) => { if (err) return res.status(500).json({ error: err.message }); res.json(row); });
});

app.post('/api/collection/:cardId', authMW, (req, res) => {
  const { quantity = 1, condition = 'Near Mint', language = 'en' } = req.body;
  db.get("SELECT * FROM collection WHERE card_id = ? AND user_id = ? AND language = ?",
    [req.params.cardId, req.userId, language],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (row) {
        db.run("UPDATE collection SET quantity = quantity + ?, condition = ? WHERE card_id = ? AND user_id = ? AND language = ?",
          [quantity, condition, req.params.cardId, req.userId, language],
          (err) => { if (err) return res.status(500).json({ error: err.message }); res.json({ success: true }); });
      } else {
        db.run("INSERT INTO collection (card_id, quantity, condition, user_id, language) VALUES (?, ?, ?, ?, ?)",
          [req.params.cardId, quantity, condition, req.userId, language],
          (err) => { if (err) return res.status(500).json({ error: err.message }); res.json({ success: true }); });
      }
    });
});

app.delete('/api/collection/:cardId', authMW, (req, res) => {
  db.run("DELETE FROM collection WHERE card_id = ? AND user_id = ? AND language = ?",
    [req.params.cardId, req.userId, req.query.language || 'en'],
    function (err) { if (err) return res.status(500).json({ error: err.message }); res.json({ success: true }); });
});

// ── Friends routes ──
app.get('/api/friends', authMW, (req, res) => {
  db.all("SELECT u.id, u.username FROM friends f JOIN users u ON f.friend_id = u.id WHERE f.user_id = ?",
    [req.userId], (err, rows) => { if (err) return res.status(500).json({ error: err.message }); res.json(rows || []); });
});

app.post('/api/friends/add', authMW, (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'Username required' });
  db.get("SELECT id FROM users WHERE username = ?", [username], (err, friend) => {
    if (!friend) return res.status(404).json({ error: 'User not found' });
    if (friend.id === req.userId) return res.status(400).json({ error: 'Cannot add yourself' });
    db.run("INSERT OR IGNORE INTO friends (user_id, friend_id) VALUES (?, ?)", [req.userId, friend.id], function (err) {
      if (err) return res.status(500).json({ error: err.message });
      db.run("INSERT OR IGNORE INTO friends (user_id, friend_id) VALUES (?, ?)", [friend.id, req.userId]);
      res.json({ success: true, message: `Added ${username}` });
    });
  });
});

app.delete('/api/friends/:friendId', authMW, (req, res) => {
  db.run("DELETE FROM friends WHERE user_id = ? AND friend_id = ?", [req.userId, req.params.friendId], () => {
    db.run("DELETE FROM friends WHERE user_id = ? AND friend_id = ?", [req.params.friendId, req.userId]);
    res.json({ success: true });
  });
});

app.get('/api/friends/:friendId/collection', authMW, (req, res) => {
  db.all(
    `SELECT col.*, c.name, c.image_url, c.set_id, c.local_id, c.rarity, c.types, c.hp, c.category, c.stage
     FROM collection col JOIN cards c ON col.card_id = c.id AND col.language = c.language
     WHERE col.user_id = ?`, [req.params.friendId],
    (err, rows) => { if (err) return res.status(500).json({ error: err.message }); res.json(rows || []); });
});

// ── Admin routes ──
app.get('/api/admin/users', adminMW, (req, res) => {
  db.all("SELECT id, username, is_admin, created_at FROM users ORDER BY id",
    (err, rows) => { if (err) return res.status(500).json({ error: err.message }); res.json(rows || []); });
});
app.put('/api/admin/users/:id', adminMW, (req, res) => {
  db.run("UPDATE users SET is_admin = ? WHERE id = ?", [req.body.is_admin ? 1 : 0, req.params.id],
    function (err) { if (err) return res.status(500).json({ error: err.message }); res.json({ success: true }); });
});
app.delete('/api/admin/users/:id', adminMW, (req, res) => {
  db.run("DELETE FROM users WHERE id = ?", [req.params.id], () => {
    db.run("DELETE FROM sessions WHERE user_id = ?", [req.params.id]);
    db.run("DELETE FROM collection WHERE user_id = ?", [req.params.id]);
    res.json({ success: true });
  });
});

// ── SPA fallback ──
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'client/public/index.html'));
});

app.listen(PORT, () => console.log(`\n🚀 Pokémon TCG server running on http://localhost:${PORT}\n`));
