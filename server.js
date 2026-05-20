const express = require('express');
const cors = require('cors');
const compression = require('compression');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(compression());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'client/public')));

const db = new sqlite3.Database('./pokemon.db');

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
});

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

db.get("SELECT COUNT(*) as count FROM cards", (err, row) => {
  if (err || row.count === 0) {
    console.log('Importing data...');
    importData();
  } else {
    console.log(`Database already has ${row.count} cards`);
  }
});

app.get('/api/sets', (req, res) => {
  db.all("SELECT * FROM sets ORDER BY releaseDate DESC", (err, rows) => {
    if (err) res.status(500).json({ error: err.message });
    else res.json(rows);
  });
});

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

  let query = "SELECT * FROM cards WHERE 1=1";
  const params = [];

  if (setName) {
    query += " AND setId = ?";
    params.push(setName);
  }

  if (type) {
    query += " AND supertype = ?";
    params.push(type);
  }

  if (pokemonType) {
    query += " AND types LIKE ?";
    params.push(`%${pokemonType}%`);
  }

  if (rarity) {
    query += " AND rarity = ?";
    params.push(rarity);
  }

  if (search) {
    query += " AND name LIKE ?";
    params.push(`%${search}%`);
  }

  const validSorts = ['name', 'number', 'rarity', 'hp'];
  const sortCol = validSorts.includes(sortBy) ? sortBy : 'name';
  const sortDir = sortOrder.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
  
  query += ` ORDER BY ${sortCol} ${sortDir} LIMIT ? OFFSET ?`;
  params.push(parseInt(limit), parseInt(offset));

  db.all(query, params, (err, rows) => {
    if (err) res.status(500).json({ error: err.message });
    else res.json(rows);
  });
});

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
          res.json(card);
        });
      });
    });
  });
});

app.get('/api/collection', (req, res) => {
  db.all(`SELECT c.*, col.quantity, col.condition, col.dateAdded FROM cards c JOIN collection col ON c.id = col.cardId`, (err, rows) => {
    if (err) res.status(500).json({ error: err.message });
    else res.json(rows);
  });
});

app.post('/api/collection/:cardId', (req, res) => {
  const { cardId } = req.params;
  const { quantity = 1, condition = 'Near Mint' } = req.body;
  
  db.get("SELECT * FROM collection WHERE cardId = ?", [cardId], (err, row) => {
    if (row) {
      db.run("UPDATE collection SET quantity = quantity + ?, condition = ? WHERE cardId = ?", [quantity, condition, cardId], function(err) {
        if (err) res.status(500).json({ error: err.message });
        else res.json({ success: true, message: 'Updated collection' });
      });
    } else {
      db.run("INSERT INTO collection (cardId, quantity, condition) VALUES (?, ?, ?)", [cardId, quantity, condition], function(err) {
        if (err) res.status(500).json({ error: err.message });
        else res.json({ success: true, message: 'Added to collection' });
      });
    }
  });
});

app.delete('/api/collection/:cardId', (req, res) => {
  const { cardId } = req.params;
  
  db.run("DELETE FROM collection WHERE cardId = ?", [cardId], function(err) {
    if (err) res.status(500).json({ error: err.message });
    else res.json({ success: true, message: 'Removed from collection' });
  });
});

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

// Pricing endpoints - using mock data based on card characteristics
// In production, this would integrate with TCGPlayer or Pokemon TCG API
function calculateMockPrice(card) {
  const basePrices = {
    'Common': 0.5,
    'Uncommon': 1,
    'Rare': 3,
    'Rare Holo': 5,
    'Rare Holo EX': 15,
    'Rare Holo GX': 20,
    'Rare Holo V': 10,
    'Rare Holo VMAX': 25,
    'Rare Ultra': 50,
    'Amazing Rare': 15,
    'LEGEND': 100,
    'Promo': 8
  };
  
  const rarity = card.rarity || 'Common';
  const setName = card.setId || '';
  
  // Higher value for newer sets
  const modernSets = ['sv', 'swsh', 'sm', 'xy'];
  const isModern = modernSets.some(s => setName.startsWith(s));
  
  let base = basePrices[rarity] || 1;
  
  // Rare Pokemon get premium
  const rarePokemon = ['Charizard', 'Pikachu', 'Mewtwo', 'Rayquaza', 'Gengar', 'Lugia'];
  const isRareMon = rarePokemon.some(p => card.name.includes(p));
  
  if (isRareMon) base *= 10;
  if (isModern) base *= 1.5;
  
  // Add some randomness for realism
  return (base + Math.random() * base * 0.5).toFixed(2);
}

app.get('/api/price/:cardId', (req, res) => {
  const { cardId } = req.params;
  
  db.get("SELECT * FROM cards WHERE id = ?", [cardId], (err, card) => {
    if (err || !card) return res.json({ price: 0, marketPrice: 0 });
    
    const marketPrice = calculateMockPrice(card);
    res.json({
      price: marketPrice,
      marketPrice: marketPrice,
      lowPrice: (marketPrice * 0.7).toFixed(2),
      highPrice: (marketPrice * 1.3).toFixed(2),
      priceUpdated: new Date().toISOString()
    });
  });
});

// Get total collection value
app.get('/api/collection/value', (req, res) => {
  db.all(`SELECT c.*, col.quantity FROM cards c JOIN collection col ON c.id = col.cardId`, (err, cards) => {
    if (err) return res.status(500).json({ error: err.message });
    
    let total = 0;
    cards.forEach(card => {
      const price = parseFloat(calculateMockPrice(card));
      total += price * (card.quantity || 1);
    });
    
    res.json({
      totalValue: total.toFixed(2),
      cardCount: cards.length,
      uniqueCards: cards.length
    });
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});