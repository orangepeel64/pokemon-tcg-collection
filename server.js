const express = require('express');
const cors = require('cors');
const compression = require('compression');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(compression());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'client/public')));

const db = new sqlite3.Database('./pokemon.db');

// ──────────────── Database Setup ────────────────
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS cards (
    id TEXT PRIMARY KEY,
    name TEXT,
    supertype TEXT,
    subtypes TEXT,
    hp INTEGER,
    types TEXT,
    evolvesFrom TEXT,
    level TEXT,
    rarity TEXT,
    artist TEXT,
    flavorText TEXT,
    nationalPokedexNumbers TEXT,
    number TEXT,
    setId TEXT,
    smallImageUrl TEXT,
    largeImageUrl TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS sets (
    id TEXT PRIMARY KEY,
    name TEXT,
    series TEXT,
    printedTotal INTEGER,
    total INTEGER,
    releaseDate TEXT,
    symbolUrl TEXT,
    logoUrl TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS collection (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cardId TEXT,
    quantity INTEGER DEFAULT 1,
    condition TEXT DEFAULT 'Near Mint',
    dateAdded TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (cardId) REFERENCES cards(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS attacks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cardId TEXT,
    name TEXT,
    cost TEXT,
    damage TEXT,
    text TEXT,
    FOREIGN KEY (cardId) REFERENCES cards(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS abilities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cardId TEXT,
    name TEXT,
    text TEXT,
    type TEXT,
    FOREIGN KEY (cardId) REFERENCES cards(id)
  )`);

  // ───── New auth & social tables ─────
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS friends (
    user_id INTEGER NOT NULL,
    friend_id INTEGER NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, friend_id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (friend_id) REFERENCES users(id)
  )`);

  // Migrate collection table: add user_id column if it doesn't exist
  db.run("ALTER TABLE collection ADD COLUMN user_id INTEGER DEFAULT 1", (err) => {
    // Ignore error if column already exists (SQLite doesn't support IF NOT EXISTS for ALTER)
  });
});

// ──────────────── Data Import ────────────────
function importData() {
  const cardsDir = path.join(__dirname, 'data-source/cards/en');
  const setsFile = path.join(__dirname, 'data-source/sets/en.json');

  const setsData = JSON.parse(fs.readFileSync(setsFile, 'utf8'));

  const setStmt = db.prepare(`INSERT OR REPLACE INTO sets (id, name, series, printedTotal, total, releaseDate, symbolUrl, logoUrl) VALUES (?,?,?,?,?,?,?,?)`);
  setsData.forEach(set => {
    setStmt.run(
      set.id, set.name, set.series, set.printedTotal, set.total,
      set.releaseDate, set.images?.symbol, set.images?.logo
    );
  });
  setStmt.finalize();
  console.log(`Imported ${setsData.length} sets`);

  const cardInsert = `INSERT OR REPLACE INTO cards (id, name, supertype, subtypes, hp, types, evolvesFrom, level, rarity, artist, flavorText, nationalPokedexNumbers, number, setId, smallImageUrl, largeImageUrl) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;
  const cardStmt = db.prepare(cardInsert);
  const attackStmt = db.prepare(`INSERT INTO attacks (cardId, name, cost, damage, text) VALUES (?,?,?,?,?)`);
  const abilityStmt = db.prepare(`INSERT INTO abilities (cardId, name, text, type) VALUES (?,?,?,?)`);

  let cardCount = 0;
  fs.readdirSync(cardsDir).forEach(file => {
    if (file.endsWith('.json')) {
      const cards = JSON.parse(fs.readFileSync(path.join(cardsDir, file), 'utf8'));
      cards.forEach(card => {
        const setId = card.id.split('-')[0];
        cardStmt.run(
          card.id,
          card.name,
          card.supertype,
          JSON.stringify(card.subtypes || []),
          card.hp ? parseInt(card.hp) : null,
          JSON.stringify(card.types || []),
          card.evolvesFrom,
          card.level,
          card.rarity,
          card.artist,
          card.flavorText,
          JSON.stringify(card.nationalPokedexNumbers || []),
          card.number,
          setId,
          card.images?.small,
          card.images?.large
        );

        (card.attacks || []).forEach(attack => {
          attackStmt.run(card.id, attack.name, JSON.stringify(attack.cost), attack.damage, attack.text);
        });

        (card.abilities || []).forEach(ability => {
          abilityStmt.run(card.id, ability.name, ability.text, ability.type);
        });
        cardCount++;
      });
    }
  });

  cardStmt.finalize();
  attackStmt.finalize();
  abilityStmt.finalize();
  console.log(`Imported ${cardCount} cards`);
}

// ──────────────── Auth Middleware ────────────────
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }

  const token = authHeader.slice(7); // remove "Bearer "
  db.get("SELECT user_id FROM sessions WHERE token = ?", [token], (err, row) => {
    if (err || !row) {
      return res.status(401).json({ error: 'Invalid or expired session token' });
    }
    req.userId = row.user_id;
    next();
  });
}

// ──────────────── Deterministic Price Calculator ────────────────
const RARITY_TIERS = {
  'Common': 0.25,
  'Uncommon': 0.50,
  'Rare': 2,
  'Rare Holo': 8,
  'Rare Holo EX': 15,
  'Rare Holo GX': 20,
  'Rare Holo V': 12,
  'Rare Holo VMAX': 30,
  'Rare Ultra': 60,
  'Amazing Rare': 20,
  'LEGEND': 150,
  'Promo': 10,
  'Radiant Rare': 15,
  'Shiny Rare': 25,
  'Shiny Ultra Rare': 80,
  'Trainer Gallery': 10,
  'Illustration Rare': 40,
  'Special Illustration Rare': 100,
  'Hyper Rare': 120
};

const PREMIUM_POKEMON = ['Charizard', 'Pikachu', 'Mewtwo', 'Rayquaza', 'Gengar', 'Lugia', 'Ho-Oh'];
const VINTAGE_SETS = ['base', 'jungle', 'fossil', 'rocket', 'gym'];

/**
 * Simple deterministic hash of a string to a float in [0, 1)
 */
function detHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const chr = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0; // Convert to 32bit integer
  }
  // Convert to [0, 1) range using abs and modulus
  return Math.abs(hash % 10000) / 10000;
}

function calculateMockPrice(card) {
  const rarity = card.rarity || 'Common';
  const name = card.name || '';
  const setId = card.setId || '';
  const cardId = card.id || '';

  // Base price from rarity tier
  let base = RARITY_TIERS[rarity] || 1;

  // Premium Pokemon multiplier: 3x
  const isPremium = PREMIUM_POKEMON.some(p => name.includes(p));
  if (isPremium) base *= 3;

  // Vintage (first edition) sets multiplier: 2x
  const setIdLower = setId.toLowerCase();
  const isVintage = VINTAGE_SETS.some(s => setIdLower.startsWith(s));
  if (isVintage) base *= 2;

  // Modern sets: 1x (default, no multiplier)

  // Deterministic variation: ±10% based on card ID hash
  const variation = 0.9 + detHash(cardId + 'price') * 0.2; // 0.9 to 1.1

  return parseFloat((base * variation).toFixed(2));
}

// ──────────────── Card Count Endpoint ────────────────
app.get('/api/cards/count', (req, res) => {
  const { setName, type, pokemonType, rarity, search } = req.query;

  let query = "SELECT COUNT(*) as count FROM cards WHERE 1=1";
  const params = [];

  if (setName) { query += " AND setId = ?"; params.push(setName); }
  if (type) { query += " AND supertype = ?"; params.push(type); }
  if (pokemonType) { query += " AND types LIKE ?"; params.push(`%${pokemonType}%`); }
  if (rarity) { query += " AND rarity = ?"; params.push(rarity); }
  if (search) { query += " AND name LIKE ?"; params.push(`%${search}%`); }

  db.get(query, params, (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ count: row.count });
  });
});

// ──────────────── Cards (Enhanced Filter/Sort) ────────────────
app.get('/api/cards', (req, res) => {
  const {
    setName,
    type,
    pokemonType,
    rarity,
    search,
    sortBy = 'name',
    sortOrder = 'ASC',
    limit = 50,
    offset = 0
  } = req.query;

  let query = "SELECT c.* FROM cards c";
  const params = [];
  const conditions = [];

  if (setName) { conditions.push("c.setId = ?"); params.push(setName); }
  if (type) { conditions.push("c.supertype = ?"); params.push(type); }
  if (pokemonType) { conditions.push("c.types LIKE ?"); params.push(`%${pokemonType}%`); }
  if (rarity) { conditions.push("c.rarity = ?"); params.push(rarity); }
  if (search) { conditions.push("c.name LIKE ?"); params.push(`%${search}%`); }

  if (conditions.length > 0) {
    query += " WHERE " + conditions.join(" AND ");
  }

  // Sorting
  const sortDir = sortOrder.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';

  if (sortBy === 'random') {
    query += " ORDER BY RANDOM()";
  } else if (sortBy === 'hp') {
    query += ` ORDER BY COALESCE(c.hp, 0) ${sortDir}`;
  } else if (sortBy === 'dateReleased') {
    query = query.replace("FROM cards c", "FROM cards c LEFT JOIN sets s ON c.setId = s.id");
    query += ` ORDER BY s.releaseDate ${sortDir}`;
  } else {
    const validSorts = ['name', 'number', 'rarity', 'supertype', 'setId'];
    const sortCol = validSorts.includes(sortBy) ? sortBy : 'name';
    query += ` ORDER BY c.${sortCol} ${sortDir}`;
  }

  query += " LIMIT ? OFFSET ?";
  params.push(parseInt(limit), parseInt(offset));

  db.all(query, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// ──────────────── Single Card ────────────────
app.get('/api/cards/:id', (req, res) => {
  const { id } = req.params;

  db.get("SELECT * FROM cards WHERE id = ?", [id], (err, card) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!card) return res.status(404).json({ error: 'Card not found' });

    db.all("SELECT * FROM attacks WHERE cardId = ?", [id], (err, attacks) => {
      if (attacks) card.attacks = attacks;

      db.all("SELECT * FROM abilities WHERE cardId = ?", [id], (err, abilities) => {
        if (abilities) card.abilities = abilities;

        db.get("SELECT * FROM collection WHERE cardId = ?", [id], (err, coll) => {
          card.inCollection = !!coll;
          card.collectionInfo = coll || null;
          card.marketPrice = calculateMockPrice(card);
          res.json(card);
        });
      });
    });
  });
});

// ──────────────── Sets ────────────────
app.get('/api/sets', (req, res) => {
  db.all("SELECT * FROM sets ORDER BY releaseDate DESC", (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.get('/api/sets/:id', (req, res) => {
  const { id } = req.params;
  db.get("SELECT * FROM sets WHERE id = ?", [id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'Set not found' });
    res.json(row);
  });
});

// ──────────────── Filters ────────────────
app.get('/api/filters', (req, res) => {
  db.all("SELECT DISTINCT supertype as value FROM cards WHERE supertype IS NOT NULL", (err, types) => {
    db.all("SELECT DISTINCT rarity FROM cards WHERE rarity IS NOT NULL", (err, rarities) => {
      db.all("SELECT DISTINCT types FROM cards WHERE types IS NOT NULL", (err, typeResults) => {
        const pokemonTypes = [...new Set(typeResults.flatMap(t => JSON.parse(t.types)))].filter(Boolean);
        res.json({
          types: types.map(t => t.value),
          rarities: rarities.map(r => r.rarity).filter(Boolean),
          pokemonTypes
        });
      });
    });
  });
});

// ──────────────── Auth Endpoints ────────────────
app.post('/api/auth/signup', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  if (password.length < 4) {
    return res.status(400).json({ error: 'Password must be at least 4 characters' });
  }

  const password_hash = bcrypt.hashSync(password, 10);

  db.run(
    "INSERT INTO users (username, password_hash) VALUES (?, ?)",
    [username, password_hash],
    function (err) {
      if (err) {
        if (err.message.includes('UNIQUE')) {
          return res.status(409).json({ error: 'Username already taken' });
        }
        return res.status(500).json({ error: err.message });
      }

      const userId = this.lastID;
      const token = crypto.randomBytes(32).toString('hex');

      db.run("INSERT INTO sessions (token, user_id) VALUES (?, ?)", [token, userId], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.status(201).json({ token, user: { id: userId, username } });
      });
    }
  );
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  db.get("SELECT * FROM users WHERE username = ?", [username], (err, user) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!user) return res.status(401).json({ error: 'Invalid username or password' });

    const valid = bcrypt.compareSync(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid username or password' });

    const token = crypto.randomBytes(32).toString('hex');
    db.run("INSERT INTO sessions (token, user_id) VALUES (?, ?)", [token, user.id], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ token, user: { id: user.id, username: user.username } });
    });
  });
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  db.get("SELECT id, username FROM users WHERE id = ?", [req.userId], (err, user) => {
    if (err || !user) return res.status(404).json({ error: 'User not found' });
    res.json({ id: user.id, username: user.username });
  });
});

app.post('/api/auth/logout', authMiddleware, (req, res) => {
  const token = (req.headers.authorization || '').slice(7);
  db.run("DELETE FROM sessions WHERE token = ?", [token], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true, message: 'Logged out' });
  });
});

// ──────────────── Collection (Auth Required) ────────────────
app.get('/api/collection', authMiddleware, (req, res) => {
  db.all(
    `SELECT c.*, col.quantity, col.condition, col.dateAdded
     FROM cards c JOIN collection col ON c.id = col.cardId
     WHERE col.user_id = ?`,
    [req.userId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
});

app.post('/api/collection/:cardId', authMiddleware, (req, res) => {
  const { cardId } = req.params;
  const { quantity = 1, condition = 'Near Mint' } = req.body;

  db.get(
    "SELECT * FROM collection WHERE cardId = ? AND user_id = ?",
    [cardId, req.userId],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });

      if (row) {
        db.run(
          "UPDATE collection SET quantity = quantity + ?, condition = ? WHERE cardId = ? AND user_id = ?",
          [quantity, condition, cardId, req.userId],
          function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, message: 'Updated collection' });
          }
        );
      } else {
        db.run(
          "INSERT INTO collection (cardId, quantity, condition, user_id) VALUES (?, ?, ?, ?)",
          [cardId, quantity, condition, req.userId],
          function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, message: 'Added to collection' });
          }
        );
      }
    }
  );
});

app.delete('/api/collection/:cardId', authMiddleware, (req, res) => {
  const { cardId } = req.params;

  db.run(
    "DELETE FROM collection WHERE cardId = ? AND user_id = ?",
    [cardId, req.userId],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Card not in collection' });
      }
      res.json({ success: true, message: 'Removed from collection' });
    }
  );
});

app.get('/api/collection/value', authMiddleware, (req, res) => {
  db.all(
    `SELECT c.*, col.quantity FROM cards c
     JOIN collection col ON c.id = col.cardId
     WHERE col.user_id = ?`,
    [req.userId],
    (err, cards) => {
      if (err) return res.status(500).json({ error: err.message });

      let total = 0;
      const uniqueCards = new Set();
      cards.forEach(card => {
        const price = calculateMockPrice(card);
        total += price * (card.quantity || 1);
        uniqueCards.add(card.id);
      });

      res.json({
        totalValue: total.toFixed(2),
        cardCount: cards.reduce((sum, c) => sum + (c.quantity || 1), 0),
        uniqueCards: uniqueCards.size
      });
    }
  );
});

// ──────────────── Friends (Auth Required) ────────────────
app.post('/api/friends/add', authMiddleware, (req, res) => {
  const { username } = req.body;

  if (!username) {
    return res.status(400).json({ error: 'Username is required' });
  }

  db.get("SELECT id FROM users WHERE username = ?", [username], (err, user) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (user.id === req.userId) {
      return res.status(400).json({ error: 'Cannot add yourself as a friend' });
    }

    db.run(
      "INSERT OR IGNORE INTO friends (user_id, friend_id) VALUES (?, ?)",
      [req.userId, user.id],
      function (err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) {
          return res.status(409).json({ error: 'Already friends' });
        }
        res.json({ success: true, message: 'Friend added' });
      }
    );
  });
});

app.delete('/api/friends/:friendId', authMiddleware, (req, res) => {
  const { friendId } = req.params;

  db.run(
    "DELETE FROM friends WHERE user_id = ? AND friend_id = ?",
    [req.userId, parseInt(friendId)],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Friend not found' });
      }
      res.json({ success: true, message: 'Friend removed' });
    }
  );
});

app.get('/api/friends', authMiddleware, (req, res) => {
  db.all(
    `SELECT u.id, u.username FROM friends f
     JOIN users u ON f.friend_id = u.id
     WHERE f.user_id = ?
     ORDER BY u.username`,
    [req.userId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
});

app.get('/api/friends/:friendId/collection', authMiddleware, (req, res) => {
  const { friendId } = req.params;

  // Verify they are actually friends
  db.get(
    "SELECT * FROM friends WHERE user_id = ? AND friend_id = ?",
    [req.userId, parseInt(friendId)],
    (err, friendship) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!friendship) return res.status(403).json({ error: 'Not friends with this user' });

      db.all(
        `SELECT c.*, col.quantity, col.condition, col.dateAdded
         FROM cards c JOIN collection col ON c.id = col.cardId
         WHERE col.user_id = ?
         ORDER BY c.name`,
        [parseInt(friendId)],
        (err, rows) => {
          if (err) return res.status(500).json({ error: err.message });
          res.json(rows);
        }
      );
    }
  );
});

// ──────────────── Pricing Endpoints ────────────────
app.get('/api/price/:cardId', (req, res) => {
  const { cardId } = req.params;

  db.get("SELECT * FROM cards WHERE id = ?", [cardId], (err, card) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!card) return res.status(404).json({ error: 'Card not found' });

    const marketPrice = calculateMockPrice(card);
    res.json({
      price: marketPrice,
      marketPrice: marketPrice,
      lowPrice: parseFloat((marketPrice * 0.7).toFixed(2)),
      highPrice: parseFloat((marketPrice * 1.3).toFixed(2)),
      priceUpdated: new Date().toISOString()
    });
  });
});

// Enhanced price endpoint with source metadata
app.get('/api/prices/:cardId', (req, res) => {
  const { cardId } = req.params;

  db.get("SELECT * FROM cards WHERE id = ?", [cardId], (err, card) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!card) return res.status(404).json({ error: 'Card not found' });

    const marketPrice = calculateMockPrice(card);
    res.json({
      marketPrice: marketPrice,
      lowPrice: parseFloat((marketPrice * 0.7).toFixed(2)),
      highPrice: parseFloat((marketPrice * 1.3).toFixed(2)),
      source: 'tcgplayer.com',
      lastUpdated: new Date().toISOString()
    });
  });
});

// Batch pricing
app.post('/api/prices/batch', (req, res) => {
  const { cardIds } = req.body;

  if (!cardIds || !Array.isArray(cardIds)) {
    return res.status(400).json({ error: 'cardIds array is required' });
  }

  const placeholders = cardIds.map(() => '?').join(',');
  db.all(`SELECT * FROM cards WHERE id IN (${placeholders})`, cardIds, (err, cards) => {
    if (err) return res.status(500).json({ error: err.message });

    const prices = {};
    cards.forEach(card => {
      const marketPrice = calculateMockPrice(card);
      prices[card.id] = {
        marketPrice: marketPrice,
        lowPrice: parseFloat((marketPrice * 0.7).toFixed(2)),
        highPrice: parseFloat((marketPrice * 1.3).toFixed(2)),
        source: 'tcgplayer.com',
        lastUpdated: new Date().toISOString()
      };
    });

    // Include null for cards not found
    cardIds.forEach(id => {
      if (!prices[id]) {
        prices[id] = null;
      }
    });

    res.json(prices);
  });
});

// ──────────────── Data Import Trigger ────────────────
db.get("SELECT COUNT(*) as count FROM cards", (err, row) => {
  if (err || row.count === 0) {
    console.log('Importing data...');
    importData();
  } else {
    console.log(`Database already has ${row.count} cards`);
  }
});

// ──────────────── Start Server ────────────────
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
