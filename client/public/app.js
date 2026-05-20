// Pokémon TCG Collection - v3 with auth, friends, filter persistence
const PerspectiveCard = window.WTCPerspectiveCard.default;

class PokemonApp {
  constructor() {
    this.apiBase = '/api';
    this.currentPage = 1;
    this.limit = 50;
    this.filters = {};
    this.sortOrder = 'ASC';
    this.collection = new Map();
    this.cardControllers = [];
    this.detailController = null;
    this.user = null;
    this.token = null;
    this.friends = [];
    this.init();
  }

  async init() {
    // Restore filters from sessionStorage
    const saved = sessionStorage.getItem('pkmn-filters');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        this.filters = parsed.filters || {};
        this.sortOrder = parsed.sortOrder || 'ASC';
        this.currentPage = parsed.currentPage || 1;
      } catch (e) { /* ignore */ }
    }

    // Restore token
    const savedToken = sessionStorage.getItem('pkmn-token');
    if (savedToken) {
      this.token = savedToken;
      try {
        const res = await fetch(`${this.apiBase}/auth/me`, { headers: { 'Authorization': `Bearer ${this.token}` } });
        if (res.ok) this.user = await res.json();
        else { this.token = null; sessionStorage.removeItem('pkmn-token'); }
      } catch (e) { this.token = null; }
    }

    this.renderAuthState();
    this.setupEventListeners();
    await this.loadFilters();
    await this.loadCards();
    await this.loadCollection();
    this.updateCollectionStats();
    this.initNav();
    if (this.user) await this.loadFriends();
  }

  // ========= NAVIGATION =========
  initNav() {
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const page = btn.dataset.page;
        this.navigate(page);
      });
    });

    // Hash-based routing
    window.addEventListener('hashchange', () => this.handleHash());
    if (location.hash) this.handleHash();
  }

  handleHash() {
    const hash = location.hash.slice(1) || 'browse';
    if (hash === 'browse') this.showBrowsePage();
    else if (hash === 'collection') this.showCollectionPage();
    else if (hash.startsWith('card-')) {
      const cardId = hash.slice(5);
      this.openCardPage(cardId);
    } else if (hash.startsWith('friend-')) {
      const friendId = hash.slice(7);
      this.showFriendCollectionPage(friendId);
    }
  }

  navigate(page, cardId) {
    if (page === 'browse') { location.hash = 'browse'; }
    else if (page === 'collection') { location.hash = 'collection'; }
    else if (page === 'card' && cardId) { location.hash = `card-${cardId}`; }
    else if (page === 'friend' && cardId) { location.hash = `friend-${cardId}`; }
  }

  showPage(name) {
    // Clean up detail card
    if (this.detailController) {
      this.detailController.playing = false;
      document.body.style.overflow = '';
      document.body.style.paddingRight = '';
      const detailEl = document.getElementById('detail-card-3d');
      if (detailEl) { detailEl.style.position = ''; detailEl.style.zIndex = ''; }
      this.detailController = null;
    }

    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const page = document.getElementById(`page-${name}`);
    if (page) page.classList.add('active');

    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    if (name === 'browse') {
      const btn = document.querySelector('.nav-btn[data-page="browse"]');
      if (btn) btn.classList.add('active');
    } else if (name === 'collection') {
      const btn = document.querySelector('.nav-btn[data-page="collection"]');
      if (btn) btn.classList.add('active');
    }
  }

  showBrowsePage() {
    this.showPage('browse');
    // Restore filter dropdowns
    this.restoreFilterDropdowns();
    if (this.cardControllers.length === 0) this.initGrid3DCards();
  }

  restoreFilterDropdowns() {
    if (this.filters.setName) document.getElementById('set-filter').value = this.filters.setName;
    if (this.filters.type) document.getElementById('type-filter').value = this.filters.type;
    if (this.filters.rarity) document.getElementById('rarity-filter').value = this.filters.rarity;
    if (this.filters.pokemonType) document.getElementById('pokemon-type-filter').value = this.filters.pokemonType;
    if (this.filters.sortBy) document.getElementById('sort-select').value = this.filters.sortBy;
    this.updateSortDirectionIcon();
  }

  saveFilters() {
    sessionStorage.setItem('pkmn-filters', JSON.stringify({
      filters: this.filters,
      sortOrder: this.sortOrder,
      currentPage: this.currentPage
    }));
  }

  // ========= AUTH =========
  renderAuthState() {
    const loggedOut = document.getElementById('auth-logged-out');
    const loggedIn = document.getElementById('auth-logged-in');

    if (this.user) {
      if (loggedOut) loggedOut.style.display = 'none';
      if (loggedIn) loggedIn.style.display = 'block';
      const display = document.getElementById('username-display');
      if (display) display.textContent = this.user.username;
    } else {
      if (loggedOut) loggedOut.style.display = 'flex';
      if (loggedIn) loggedIn.style.display = 'none';
    }
  }

  showAuthModal(mode) {
    const overlay = document.getElementById('auth-modal-overlay');
    const tabs = document.getElementById('auth-tabs');
    const loginForm = document.getElementById('login-form');
    const signupForm = document.getElementById('signup-form');
    const error = document.getElementById('auth-error');

    overlay.style.display = 'flex';
    error.style.display = 'none';

    if (mode === 'login') {
      tabs.querySelector('[data-tab="login"]').classList.add('active');
      tabs.querySelector('[data-tab="signup"]').classList.remove('active');
      loginForm.style.display = 'flex';
      signupForm.style.display = 'none';
    } else {
      tabs.querySelector('[data-tab="signup"]').classList.add('active');
      tabs.querySelector('[data-tab="login"]').classList.remove('active');
      signupForm.style.display = 'flex';
      loginForm.style.display = 'none';
    }
  }

  hideAuthModal() {
    document.getElementById('auth-modal-overlay').style.display = 'none';
  }

  async login(username, password) {
    try {
      const res = await fetch(`${this.apiBase}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Login failed');
      this.token = data.token;
      this.user = data.user;
      sessionStorage.setItem('pkmn-token', this.token);
      this.hideAuthModal();
      this.renderAuthState();
      await this.loadCollection();
      await this.loadFriends();
      this.updateCollectionStats();
    } catch (e) {
      const error = document.getElementById('auth-error');
      error.textContent = e.message;
      error.style.display = 'block';
    }
  }

  async signup(username, password) {
    try {
      const res = await fetch(`${this.apiBase}/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Signup failed');
      this.token = data.token;
      this.user = data.user;
      sessionStorage.setItem('pkmn-token', this.token);
      this.hideAuthModal();
      this.renderAuthState();
      await this.loadCollection();
      await this.loadFriends();
      this.updateCollectionStats();
    } catch (e) {
      const error = document.getElementById('auth-error');
      error.textContent = e.message;
      error.style.display = 'block';
    }
  }

  async logout() {
    try {
      await fetch(`${this.apiBase}/auth/logout`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${this.token}` }
      });
    } catch (e) { /* ignore */ }
    this.token = null;
    this.user = null;
    this.collection.clear();
    this.friends = [];
    sessionStorage.removeItem('pkmn-token');
    this.renderAuthState();
    this.updateCollectionStats();
    // hide dropdown
    const menu = document.getElementById('user-dropdown-menu');
    if (menu) menu.classList.remove('show');
    // refresh current view
    this.loadCards();
  }

  // ========= FRIENDS =========
  async loadFriends() {
    if (!this.token) return;
    try {
      const res = await fetch(`${this.apiBase}/friends`, {
        headers: { 'Authorization': `Bearer ${this.token}` }
      });
      if (res.ok) this.friends = await res.json();
      this.renderFriendList();
    } catch (e) { /* ignore */ }
  }

  renderFriendList() {
    const list = document.getElementById('friends-list');
    if (!list) return;
    if (this.friends.length === 0) {
      list.innerHTML = '<div class="loading" style="padding:20px;text-align:center;color:var(--gray);">No friends yet</div>';
      return;
    }
    list.innerHTML = this.friends.map(f => `
      <div class="friend-item">
        <span class="friend-name"><i class="fas fa-user"></i> ${this.escape(f.username)}</span>
        <div class="friend-actions">
          <button class="friend-action-btn view" data-friend-id="${f.id}" title="View collection"><i class="fas fa-eye"></i></button>
          <button class="friend-action-btn remove-friend" data-friend-id="${f.id}" title="Remove friend"><i class="fas fa-user-times"></i></button>
        </div>
      </div>
    `).join('');

    // Event listeners
    list.querySelectorAll('.friend-action-btn.view').forEach(btn => {
      btn.addEventListener('click', () => {
        const friendId = btn.dataset.friendId;
        this.showFriendCollectionPage(friendId);
        this.hideFriendsSidebar();
      });
    });
    list.querySelectorAll('.friend-action-btn.remove-friend').forEach(btn => {
      btn.addEventListener('click', () => this.removeFriend(btn.dataset.friendId));
    });
  }

  async addFriend(username) {
    try {
      const res = await fetch(`${this.apiBase}/friends/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.token}` },
        body: JSON.stringify({ username })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to add friend');
      document.getElementById('add-friend-input').value = '';
      await this.loadFriends();
    } catch (e) {
      const err = document.getElementById('friends-error');
      err.textContent = e.message;
      err.style.display = 'block';
      setTimeout(() => { err.style.display = 'none'; }, 3000);
    }
  }

  async removeFriend(friendId) {
    try {
      await fetch(`${this.apiBase}/friends/${friendId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${this.token}` }
      });
      await this.loadFriends();
    } catch (e) { /* ignore */ }
  }

  async showFriendCollectionPage(friendId) {
    this.showPage('friend');
    const container = document.getElementById('friend-collection-content');
    container.innerHTML = '<div class="loading">Loading friend\'s collection...</div>';

    const friend = this.friends.find(f => f.id == friendId);
    const friendName = friend ? friend.username : 'Friend';

    try {
      const [cardsRes, valueRes] = await Promise.all([
        fetch(`${this.apiBase}/friends/${friendId}/collection`, {
          headers: { 'Authorization': `Bearer ${this.token}` }
        }),
        // Get value by fetching all cards and calculating
        (async () => {
          const r = await fetch(`${this.apiBase}/friends/${friendId}/collection`, {
            headers: { 'Authorization': `Bearer ${this.token}` }
          });
          return r.json();
        })()
      ]);
      const cards = await cardsRes.json();

      if (cards.length === 0) {
        container.innerHTML = `
          <div class="empty-state">
            <i class="fas fa-heart-broken"></i>
            <h3>${this.escape(friendName)}'s collection is empty</h3>
          </div>
        `;
        return;
      }

      container.innerHTML = `
        <div class="collection-header">
          <h2><i class="fas fa-user"></i> ${this.escape(friendName)}'s Collection</h2>
          <div class="collection-stats">
            <div class="collection-stat">
              <div class="num">${cards.length}</div>
              <div class="lbl">Unique Cards</div>
            </div>
            <div class="collection-stat">
              <div class="num">${cards.reduce((s, c) => s + (c.quantity || 1), 0)}</div>
              <div class="lbl">Total Copies</div>
            </div>
          </div>
        </div>
        <div class="collection-grid">
          ${cards.map(card => `
            <div class="collection-card" data-card-id="${card.id}">
              <img src="${card.smallImageUrl}" alt="${card.name}" loading="lazy">
              <div class="card-footer">
                ${card.name} <span class="qty">${card.quantity || 1}×</span>
              </div>
            </div>
          `).join('')}
        </div>
      `;

      container.querySelectorAll('.collection-card').forEach(el => {
        el.addEventListener('click', () => {
          const cardId = el.dataset.cardId;
          if (cardId) this.navigate('card', cardId);
        });
      });
    } catch (e) {
      container.innerHTML = '<div class="loading">Error loading collection</div>';
      console.error(e);
    }
  }

  showFriendsSidebar() {
    document.getElementById('friends-sidebar-overlay').style.display = 'block';
    document.getElementById('friends-sidebar').classList.add('open');
  }

  hideFriendsSidebar() {
    document.getElementById('friends-sidebar-overlay').style.display = 'none';
    document.getElementById('friends-sidebar').classList.remove('open');
  }

  // ========= FILTERS =========
  updateSortDirectionIcon() {
    const icon = document.getElementById('sort-direction-icon');
    const btn = document.getElementById('sort-direction-btn');
    if (!icon || !btn) return;
    if (this.sortOrder === 'DESC') {
      icon.className = 'fas fa-arrow-down';
      btn.classList.add('desc');
    } else {
      icon.className = 'fas fa-arrow-up';
      btn.classList.remove('desc');
    }
  }

  async loadFilters() {
    try {
      const setsRes = await fetch(`${this.apiBase}/sets`);
      const sets = await setsRes.json();
      const setSelect = document.getElementById('set-filter');
      setSelect.innerHTML = '<option value="">All Sets</option>';
      sets.forEach(set => {
        const opt = document.createElement('option');
        opt.value = set.id;
        opt.textContent = set.name;
        setSelect.appendChild(opt);
      });

      const filtersRes = await fetch(`${this.apiBase}/filters`);
      const filters = await filtersRes.json();

      const typeSelect = document.getElementById('type-filter');
      typeSelect.innerHTML = '<option value="">All</option>';
      filters.types.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t; opt.textContent = t;
        typeSelect.appendChild(opt);
      });

      const raritySelect = document.getElementById('rarity-filter');
      raritySelect.innerHTML = '<option value="">All</option>';
      filters.rarities.forEach(r => {
        const opt = document.createElement('option');
        opt.value = r; opt.textContent = r;
        raritySelect.appendChild(opt);
      });

      const pokeTypeSelect = document.getElementById('pokemon-type-filter');
      pokeTypeSelect.innerHTML = '<option value="">All</option>';
      filters.pokemonTypes.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t; opt.textContent = t;
        pokeTypeSelect.appendChild(opt);
      });

      // Restore saved filter values
      this.restoreFilterDropdowns();
    } catch (e) { console.error('Error loading filters:', e); }
  }

  // ========= CARDS BROWSE =========
  async loadCards() {
    const container = document.getElementById('cards-container');
    container.innerHTML = '<div class="loading">Loading cards...</div>';

    this.destroyGrid3DCards();

    try {
      const params = new URLSearchParams({
        limit: this.limit,
        offset: (this.currentPage - 1) * this.limit,
        sortBy: this.filters.sortBy || 'name',
        sortOrder: this.sortOrder
      });

      if (this.filters.search) params.set('search', this.filters.search);
      if (this.filters.setName) params.set('setName', this.filters.setName);
      if (this.filters.type) params.set('type', this.filters.type);
      if (this.filters.rarity) params.set('rarity', this.filters.rarity);
      if (this.filters.pokemonType) params.set('pokemonType', this.filters.pokemonType);

      const res = await fetch(`${this.apiBase}/cards?${params}`);
      const cards = await res.json();

      container.innerHTML = cards.map(card => {
        const types = JSON.parse(card.types || '[]');
        const inCollection = this.collection.has(card.id);
        const rarityStars = this.getRarityStars(card.rarity);

        return `
          <div class="perspective-card" data-card-id="${card.id}">
            <div class="perspective-card__transformer">
              <div class="perspective-card__artwork perspective-card__artwork--front">
                <img src="${card.smallImageUrl}" alt="${card.name}" loading="lazy" />
              </div>
              <div class="perspective-card__artwork perspective-card__artwork--back">
                <img src="https://images.pokemontcg.io/swsh/back.png" alt="Card Back"
                     onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 245 342%22><rect width=%22245%22 height=%22342%22 fill=%22%230071ba%22/><text x=%22122%22 y=%22171%22 text-anchor=%22middle%22 fill=%22white%22 font-size=%2220%22 font-weight=%22bold%22>Pokémon</text></svg>'">
              </div>
              <div class="perspective-card__shine"></div>
            </div>
            ${inCollection ? '<div class="collection-indicator"><i class="fas fa-heart"></i></div>' : ''}
            <span class="card-rarity-badge ${this.getRarityClass(card.rarity)}">${rarityStars} ${card.rarity || '—'}</span>
            <div class="card-grid-label">
              <h3>${card.name}</h3>
              <div class="info">
                <span>${(card.setId || '').toUpperCase()} #${card.number || '?'}</span>
                <span>${types.join('/') || '—'}</span>
              </div>
            </div>
          </div>
        `;
      }).join('');

      document.getElementById('page-info').textContent = `Page ${this.currentPage}`;

      // Wait for DOM update then init 3D
      requestAnimationFrame(() => {
        this.initGrid3DCards();
      });

      // Click to open detail
      container.querySelectorAll('.perspective-card').forEach(el => {
        el.addEventListener('click', (e) => {
          if (e.button !== 0) return;
          const cardId = el.dataset.cardId;
          if (!cardId) return;
          this.destroyGrid3DCards();
          this.navigate('card', cardId);
        });
        // Middle click to toggle collection
        el.addEventListener('auxclick', async (e) => {
          if (e.button === 1) {
            e.preventDefault();
            const cardId = el.dataset.cardId;
            await this.toggleCollection(cardId);
            await this.loadCards();
          }
        });
      });

    } catch (e) {
      container.innerHTML = '<div class="loading">Error loading cards</div>';
      console.error(e);
    }
  }

  // ========= 3D GRID CARDS =========
  initGrid3DCards() {
    this.destroyGrid3DCards();
    document.querySelectorAll('.perspective-card').forEach(el => {
      try {
        const ctrl = new PerspectiveCard(el, { intensity: 8, zoomSize: 20 });
        ctrl.playing = true;
        this.cardControllers.push(ctrl);
      } catch (e) { /* skip */ }
    });
  }

  destroyGrid3DCards() {
    this.cardControllers.forEach(c => { try { c.playing = false; } catch (e) {} });
    this.cardControllers = [];
  }

  // ========= COLLECTION =========
  async loadCollection() {
    if (!this.token) { this.collection.clear(); return; }
    try {
      const res = await fetch(`${this.apiBase}/collection`, {
        headers: { 'Authorization': `Bearer ${this.token}` }
      });
      const cards = await res.json();
      this.collection.clear();
      cards.forEach(c => this.collection.set(c.id, c));
    } catch (e) { console.error('Error loading collection:', e); }
  }

  updateCollectionStats() {
    const count = this.collection.size;
    document.querySelectorAll('#collection-count').forEach(el => el.textContent = count);

    if (!this.token) {
      const valEl = document.getElementById('collection-value');
      if (valEl) valEl.innerHTML = 'Value: <span class="value">$0.00</span>';
      return;
    }

    fetch(`${this.apiBase}/collection/value`, {
      headers: { 'Authorization': `Bearer ${this.token}` }
    })
      .then(r => r.json())
      .then(data => {
        const valEl = document.getElementById('collection-value');
        if (valEl) valEl.innerHTML = `Value: <span class="value">$${data.totalValue || '0.00'}</span>`;
      })
      .catch(() => {});
  }

  async addToCollection(cardId, quantity = 1) {
    if (!this.token) {
      this.showAuthModal('login');
      return;
    }
    try {
      await fetch(`${this.apiBase}/collection/${cardId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.token}` },
        body: JSON.stringify({ quantity: parseInt(quantity) })
      });
      this.collection.set(cardId, { id: cardId, quantity: parseInt(quantity) });
      this.updateCollectionStats();
    } catch (e) { console.error(e); }
  }

  async removeFromCollection(cardId) {
    if (!this.token) return;
    try {
      await fetch(`${this.apiBase}/collection/${cardId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${this.token}` }
      });
      this.collection.delete(cardId);
      this.updateCollectionStats();
    } catch (e) { console.error(e); }
  }

  async toggleCollection(cardId) {
    if (!this.token) { this.showAuthModal('login'); return; }
    if (this.collection.has(cardId)) {
      await this.removeFromCollection(cardId);
    } else {
      await this.addToCollection(cardId, 1);
    }
    const hash = location.hash.slice(1);
    if (hash === 'collection') this.showCollectionPage();
    else if (hash.startsWith('card-')) this.openCardPage(hash.slice(5));
    else this.loadCards();
  }

  // ========= CARD DETAIL PAGE =========
  async openCardPage(cardId) {
    this.showPage('card');

    const content = document.getElementById('card-page-content');
    content.innerHTML = '<div class="loading">Loading card...</div>';

    try {
      const [cardRes, priceRes] = await Promise.all([
        fetch(`${this.apiBase}/cards/${cardId}`),
        fetch(`${this.apiBase}/price/${cardId}`)
      ]);
      const card = await cardRes.json();
      const priceData = await priceRes.json();

      const types = JSON.parse(card.types || '[]');
      const attacks = card.attacks || [];
      const abilities = card.abilities || [];
      const pokedexNums = JSON.parse(card.nationalPokedexNumbers || '[]');
      const inCollection = this.collection.has(cardId);
      const collData = this.collection.get(cardId) || {};
      const rarityStars = this.getRarityStars(card.rarity);

      content.innerHTML = `
        <div class="card-3d-viewer" id="card-detail-viewer">
          <div class="perspective-card" id="detail-card-3d">
            <div class="perspective-card__transformer">
              <div class="perspective-card__artwork perspective-card__artwork--front">
                <img src="${card.largeImageUrl || card.smallImageUrl}" alt="${card.name}" />
              </div>
              <div class="perspective-card__artwork perspective-card__artwork--back">
                <img src="https://images.pokemontcg.io/swsh/back.png" alt="Back"
                     onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 245 342%22><rect width=%22245%22 height=%22342%22 fill=%22%230071ba%22/><text x=%22122%22 y=%22171%22 text-anchor=%22middle%22 fill=%22white%22 font-size=%2220%22 font-weight=%22bold%22>Pokémon</text></svg>'">
              </div>
              <div class="perspective-card__shine"></div>
            </div>
          </div>
        </div>

        <div class="card-details">
          <h1>${card.name}</h1>
          <div class="card-set-badge">${(card.setId || '').toUpperCase()} #${card.number || '?'}</div>

          ${pokedexNums.length > 0 ? `
            <div class="stat-card" style="margin-bottom: 15px;">
              <span>Pokédex: #${pokedexNums[0]}</span>
            </div>
          ` : ''}

          <div class="card-stats-grid">
            <div class="stat-card"><div class="value">${card.hp || '-'}</div><div class="label">HP</div></div>
            <div class="stat-card">
              <div class="value ${this.getRarityClass(card.rarity)}">${rarityStars} ${card.rarity || '-'}</div>
              <div class="label">Rarity</div>
            </div>
            <div class="stat-card"><div class="value">${types.join('/') || '—'}</div><div class="label">Types</div></div>
            <div class="stat-card"><div class="value">${card.supertype || '—'}</div><div class="label">Category</div></div>
          </div>

          <div class="price-display">
            <div class="label">Market Price</div>
            <div class="amount">$${priceData.marketPrice || '0.00'}</div>
            <div class="price-range">
              <span class="price-low">Low: $${priceData.lowPrice || '—'}</span>
              <span class="price-high">High: $${priceData.highPrice || '—'}</span>
            </div>
            <div class="price-chart">
              <div class="chart-bar" style="width:100%">
                <div class="chart-fill chart-fill-low" style="width:70%"></div>
              </div>
              <div class="chart-labels">
                <span>$${priceData.lowPrice || '0'}</span>
                <span>$${priceData.marketPrice || '0'}</span>
                <span>$${priceData.highPrice || '0'}</span>
              </div>
            </div>
            <div class="price-source">
              <i class="fas fa-chart-line"></i> Source: tcgplayer.com | Updated: ${new Date(priceData.priceUpdated || Date.now()).toLocaleDateString()}
            </div>
            <div style="margin-top: 10px; font-size: 0.85rem;">
              ${inCollection ? `In Collection: ${collData.quantity || 1} copy/copies` : 'Not in collection'}
            </div>
          </div>

          <div class="collection-options">
            <div class="option-row">
              <label>Quantity</label>
              <input type="number" id="detail-qty-input" value="1" min="1" max="10">
            </div>
            <div class="option-row">
              <label>Condition</label>
              <select id="detail-condition-select">
                <option value="Near Mint">Near Mint</option>
                <option value="Lightly Played">Lightly Played</option>
                <option value="Moderately Played">Moderately Played</option>
                <option value="Heavily Played">Heavily Played</option>
              </select>
            </div>
            <div style="display:flex; gap:10px;">
              <button class="btn-primary add-collection-btn" id="detail-add-btn">
                <i class="fas fa-heart"></i> ${inCollection ? 'Update Collection' : 'Add to Collection'}
              </button>
              ${inCollection ? `
                <button class="btn-secondary add-collection-btn" id="detail-remove-btn" style="flex:0.3;">
                  <i class="fas fa-trash"></i>
                </button>
              ` : ''}
            </div>
          </div>

          ${attacks.length > 0 ? `
            <div class="card-section">
              <h3><i class="fas fa-bolt"></i> Attacks</h3>
              ${attacks.map(a => `
                <div class="attack-card">
                  <div class="name">${a.name} ${a.damage ? `<span class="damage">${a.damage}</span>` : ''}</div>
                  <div class="text">${a.text || ''}</div>
                </div>
              `).join('')}
            </div>
          ` : ''}

          ${abilities.length > 0 ? `
            <div class="card-section">
              <h3><i class="fas fa-magic"></i> Abilities</h3>
              ${abilities.map(a => `
                <div class="ability-card">
                  <div class="name">${a.name} <span style="color: var(--gray); font-weight: normal;">(${a.type})</span></div>
                  <div class="text">${a.text}</div>
                </div>
              `).join('')}
            </div>
          ` : ''}

          ${card.flavorText ? `
            <div class="flavor-text">"${card.flavorText}"</div>
          ` : ''}

          ${card.artist ? `
            <div class="card-section">
              <h3><i class="fas fa-palette"></i> Artist</h3>
              <div style="color: var(--gray);">${card.artist}</div>
            </div>
          ` : ''}
        </div>
      `;

      // Init PerspectiveCard for tilt only
      const detailEl = document.getElementById('detail-card-3d');
      if (detailEl) {
        if (this.detailController) this.detailController.playing = false;
        this.detailController = new PerspectiveCard(detailEl, { intensity: 12, zoomSize: 25 });
        this.detailController.pointerControlled = true;
        this.detailController.playing = true;
      }

      // Detail page action buttons
      document.getElementById('detail-add-btn').addEventListener('click', async () => {
        if (!this.token) { this.showAuthModal('login'); return; }
        const qty = parseInt(document.getElementById('detail-qty-input').value) || 1;
        await this.addToCollection(cardId, qty);
        this.openCardPage(cardId);
      });

      const removeBtn = document.getElementById('detail-remove-btn');
      if (removeBtn) {
        removeBtn.addEventListener('click', async () => {
          await this.removeFromCollection(cardId);
          this.openCardPage(cardId);
        });
      }

    } catch (e) {
      content.innerHTML = '<div class="loading">Error loading card</div>';
      console.error(e);
    }
  }

  // ========= COLLECTION PAGE =========
  async showCollectionPage() {
    if (!this.token) { this.showAuthModal('login'); return; }
    this.showPage('collection');
    const container = document.getElementById('collection-content');
    container.innerHTML = '<div class="loading">Loading collection...</div>';

    try {
      const [cardsRes, valueRes] = await Promise.all([
        fetch(`${this.apiBase}/collection`, { headers: { 'Authorization': `Bearer ${this.token}` } }),
        fetch(`${this.apiBase}/collection/value`, { headers: { 'Authorization': `Bearer ${this.token}` } })
      ]);
      const cards = await cardsRes.json();
      const valueData = await valueRes.json();

      if (cards.length === 0) {
        container.innerHTML = `
          <div class="empty-state">
            <i class="fas fa-heart-broken"></i>
            <h3>Your collection is empty</h3>
            <p>Middle-click any card to add it, or click the heart icon on the detail page.</p>
            <button class="btn-primary" onclick="app.navigate('browse')" style="margin-top:20px;">
              <i class="fas fa-th"></i> Browse Cards
            </button>
          </div>
        `;
        return;
      }

      container.innerHTML = `
        <div class="collection-header">
          <h2><i class="fas fa-heart"></i> My Collection</h2>
          <div class="collection-stats">
            <div class="collection-stat">
              <div class="num">${valueData.uniqueCards || cards.length}</div>
              <div class="lbl">Unique Cards</div>
            </div>
            <div class="collection-stat">
              <div class="num">${cards.reduce((s, c) => s + (c.quantity || 1), 0)}</div>
              <div class="lbl">Total Copies</div>
            </div>
            <div class="collection-stat">
              <div class="num">$${valueData.totalValue || '0.00'}</div>
              <div class="lbl">Estimated Value</div>
            </div>
          </div>
        </div>
        <div class="collection-grid">
          ${cards.map(card => `
            <div class="collection-card" data-card-id="${card.id}">
              <img src="${card.smallImageUrl}" alt="${card.name}" loading="lazy">
              <div class="card-footer">
                ${card.name} <span class="qty">${card.quantity || 1}×</span>
              </div>
              <button class="remove-btn" title="Remove from collection">&times;</button>
            </div>
          `).join('')}
        </div>
      `;

      container.querySelectorAll('.collection-card').forEach(el => {
        el.addEventListener('click', (e) => {
          if (e.target.closest('.remove-btn')) return;
          const cardId = el.dataset.cardId;
          if (cardId) this.navigate('card', cardId);
        });
        el.querySelector('.remove-btn').addEventListener('click', async (e) => {
          e.stopPropagation();
          await this.removeFromCollection(el.dataset.cardId);
          this.showCollectionPage();
        });
      });
    } catch (e) {
      container.innerHTML = '<div class="loading">Error loading collection</div>';
      console.error(e);
    }
  }

  // ========= RARITY HELPERS =========
  getRarityStars(rarity) {
    if (!rarity) return '';
    const r = rarity.toLowerCase();
    if (r.includes('hyper') || r.includes('secret')) return '★★★★★';
    if (r.includes('ultra') || r.includes('special illustration') || r.includes('illustration rare')) return '★★★★☆';
    if (r.includes('holo') || r.includes('amazing') || r.includes('radiant') || r.includes('shiny') || r.includes('legend') || r.includes('trainer gallery')) return '★★★☆☆';
    if (r.includes('rare')) return '★★☆☆☆';
    if (r.includes('uncommon')) return '★☆☆☆☆';
    return '';
  }

  getRarityClass(rarity) {
    if (!rarity) return 'rarity-common';
    const r = rarity.toLowerCase();
    if (r.includes('hyper') || r.includes('secret') || r.includes('ultra') || r.includes('illustration') || r.includes('special illustration')) return 'rarity-ultra';
    if (r.includes('holo') || r.includes('amazing') || r.includes('radiant') || r.includes('shiny') || r.includes('legend') || r.includes('trainer gallery') || r.includes('promo')) return 'rarity-holo';
    if (r.includes('rare')) return 'rarity-rare';
    if (r.includes('uncommon')) return 'rarity-uncommon';
    return 'rarity-common';
  }

  // ========= EVENT LISTENERS =========
  setupEventListeners() {
    // Search
    document.getElementById('search-input').addEventListener('input', (e) => {
      clearTimeout(this.searchTimer);
      this.searchTimer = setTimeout(() => {
        this.filters.search = e.target.value;
        this.currentPage = 1;
        this.saveFilters();
        this.loadCards();
      }, 300);
    });

    // Filter changes
    ['set-filter', 'type-filter', 'rarity-filter', 'pokemon-type-filter'].forEach(id => {
      document.getElementById(id).addEventListener('change', (e) => {
        const key = id === 'set-filter' ? 'setName'
                  : id === 'type-filter' ? 'type'
                  : id === 'rarity-filter' ? 'rarity'
                  : 'pokemonType';
        this.filters[key] = e.target.value;
        this.currentPage = 1;
        this.saveFilters();
        this.loadCards();
      });
    });

    // Sort select
    document.getElementById('sort-select').addEventListener('change', (e) => {
      this.filters.sortBy = e.target.value;
      this.currentPage = 1;
      this.saveFilters();
      this.loadCards();
    });

    // Sort direction toggle
    document.getElementById('sort-direction-btn').addEventListener('click', () => {
      this.sortOrder = this.sortOrder === 'ASC' ? 'DESC' : 'ASC';
      this.updateSortDirectionIcon();
      this.saveFilters();
      this.loadCards();
    });

    // Pagination
    document.getElementById('prev-page').addEventListener('click', () => {
      if (this.currentPage > 1) { this.currentPage--; this.saveFilters(); this.loadCards(); }
    });
    document.getElementById('next-page').addEventListener('click', () => {
      this.currentPage++; this.saveFilters(); this.loadCards();
    });

    // Back button on card detail
    document.getElementById('card-back-btn').addEventListener('click', () => {
      this.navigate('browse');
    });
    document.getElementById('card-collection-nav-btn').addEventListener('click', () => {
      this.navigate('collection');
    });

    // Auth modal
    document.getElementById('btn-show-login').addEventListener('click', () => this.showAuthModal('login'));
    document.getElementById('btn-show-signup').addEventListener('click', () => this.showAuthModal('signup'));
    document.getElementById('auth-modal-close').addEventListener('click', () => this.hideAuthModal());
    document.getElementById('auth-modal-overlay').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) this.hideAuthModal();
    });

    // Auth tabs
    document.querySelectorAll('#auth-tabs .auth-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const mode = tab.dataset.tab;
        document.querySelectorAll('#auth-tabs .auth-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById('login-form').style.display = mode === 'login' ? 'flex' : 'none';
        document.getElementById('signup-form').style.display = mode === 'signup' ? 'flex' : 'none';
        document.getElementById('auth-error').style.display = 'none';
      });
    });

    // Auth forms
    document.getElementById('login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = document.getElementById('login-username').value.trim();
      const password = document.getElementById('login-password').value;
      if (!username || !password) return;
      await this.login(username, password);
    });

    document.getElementById('signup-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = document.getElementById('signup-username').value.trim();
      const password = document.getElementById('signup-password').value;
      if (!username || !password) return;
      if (password.length < 4) {
        document.getElementById('auth-error').textContent = 'Password must be at least 4 characters';
        document.getElementById('auth-error').style.display = 'block';
        return;
      }
      await this.signup(username, password);
    });

    // User dropdown
    document.getElementById('user-menu-btn').addEventListener('click', () => {
      document.getElementById('user-dropdown-menu').classList.toggle('show');
    });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.user-dropdown')) {
        document.getElementById('user-dropdown-menu').classList.remove('show');
      }
    });

    // Dropdown nav buttons
    document.querySelector('#user-dropdown-menu button[data-nav="collection"]').addEventListener('click', () => {
      this.navigate('collection');
      document.getElementById('user-dropdown-menu').classList.remove('show');
    });
    document.getElementById('btn-show-friends').addEventListener('click', () => {
      this.showFriendsSidebar();
      document.getElementById('user-dropdown-menu').classList.remove('show');
    });
    document.getElementById('btn-logout').addEventListener('click', () => this.logout());

    // Friends sidebar
    document.getElementById('friends-close').addEventListener('click', () => this.hideFriendsSidebar());
    document.getElementById('friends-sidebar-overlay').addEventListener('click', () => this.hideFriendsSidebar());
    document.getElementById('add-friend-btn').addEventListener('click', () => {
      const input = document.getElementById('add-friend-input');
      const username = input.value.trim();
      if (username) this.addFriend(username);
    });
    document.getElementById('add-friend-input').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        const username = e.target.value.trim();
        if (username) this.addFriend(username);
      }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.hideAuthModal();
        this.hideFriendsSidebar();
        document.getElementById('user-dropdown-menu').classList.remove('show');
      }
    });
  }

  // ========= UTILS =========
  escape(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}

// Boot
window.addEventListener('DOMContentLoaded', () => {
  window.app = new PokemonApp();
});
