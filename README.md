# Pokémon TCG Collection Manager

A stunning, state-of-the-art Pokémon card collection website with beautiful 3D perspective effects, filtering, and personal collection tracking.

## Features

### ✨ 3D Perspective Cards
- Interactive 3D hover effects with real-time perspective transformation
- Glare animations on mouse movement
- Smooth animations and transitions

### 🔍 Powerful Filtering & Sorting
- Search by card name
- Filter by Set, Type, Rarity, and Pokémon Type
- Sort by Name, Number, Rarity, or HP

### 📚 Comprehensive Card Database
- 20,000+ Pokémon TCG cards from all sets
- Full card details including attacks, abilities, and flavor text
- High-resolution card images

### ❤️ Personal Collection
- Add/remove cards from your personal collection
- Track which cards you own
- Collection counter in header

### 📱 Responsive Design
- Works on desktop, tablet, and mobile
- Modern dark theme with Pokémon-inspired colors
- Animated background effects

## Tech Stack

- **Backend**: Node.js + Express + SQLite
- **Frontend**: Vanilla JavaScript + CSS3 (no frameworks!)
- **Data**: PokemonTCG/pokemon-tcg-data repository
- **Styling**: Modern CSS with 3D transforms and animations

## API Endpoints

- `GET /api/cards` - List cards with filtering and pagination
- `GET /api/cards/:id` - Get single card details
- `GET /api/sets` - Get all card sets
- `GET /api/filters` - Get filter options (types, rarities)
- `GET /api/collection` - Get your collection
- `POST /api/collection/:cardId` - Add card to collection
- `DELETE /api/collection/:cardId` - Remove card from collection

## Running Locally

```bash
cd pokemon-website
npm install
node server.js
```

Visit http://localhost:3001

## Usage

1. Browse cards using the filter controls at the top
2. Click any card to see full details in a modal
3. Click the heart button to add/remove cards from your collection
4. Your collection count updates in real-time

## Collections Features

- Click "My Collection" button to view all cards you've saved
- Cards in your collection show a red heart indicator on the grid
- Easily manage your physical card collection digitally

Enjoy your Pokémon card collection! 🌟