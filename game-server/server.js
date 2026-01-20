const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = 3000;
const GAME_TIME = 180; // 3 minutes in seconds
const RECONNECT_GRACE_PERIOD = 30000; // 30 seconds to reconnect
const LEADERBOARD_FILE = path.join(__dirname, 'leaderboard.json');
const ITEMS_FILE = path.join(__dirname, 'items.json');
const SCRABBLE_GAMES_FILE = path.join(__dirname, 'scrabble_games.json');
const MAX_LEADERBOARD_ENTRIES = 20;
const SESSION_DURATION_DAYS = 90;

// Item configuration - Tiered category system
const ITEM_CATEGORIES = {
    coins: {
        dropRate: 0.69,
        items: {
            silver_coin: { chance: 0.638, icon: '🔘', name: 'Silver Coin', rarity: 'common' },
            gold_coin: { chance: 0.362, icon: '🪙', name: 'Gold Coin', rarity: 'common' }
        }
    },
    gems: {
        dropRate: 0.30,
        items: {
            opal: { chance: 0.40, icon: '⚪', name: 'Opal', rarity: 'uncommon' },
            amethyst: { chance: 0.30, icon: '🟣', name: 'Amethyst', rarity: 'uncommon' },
            moonstone: { chance: 0.14, icon: '🌙', name: 'Moonstone', rarity: 'rare' },
            ruby: { chance: 0.09, icon: '🔴', name: 'Ruby', rarity: 'rare' },
            sapphire: { chance: 0.05, icon: '🔵', name: 'Sapphire', rarity: 'epic' },
            diamond: { chance: 0.02, icon: '💎', name: 'Diamond', rarity: 'legendary' }
        }
    },
    exotic: {
        dropRate: 0.01,
        items: {
            faded_page: { chance: 0.50, icon: '📜', name: 'Faded Page', rarity: 'legendary' },
            cursed_amulet: { chance: 0.50, icon: '🧿', name: 'Cursed Amulet', rarity: 'mythic' }
        }
    }
};

const ITEM_ORDER = ['silver_coin', 'gold_coin', 'opal', 'amethyst', 'moonstone', 'ruby', 'sapphire', 'diamond', 'faded_page', 'cursed_amulet'];

// Load or initialize leaderboard
function loadLeaderboard() {
    try {
        if (fs.existsSync(LEADERBOARD_FILE)) {
            const data = fs.readFileSync(LEADERBOARD_FILE, 'utf8');
            const lb = JSON.parse(data);
            // Ensure wins array exists (migration for existing data)
            if (!lb.singleplayer.wins) lb.singleplayer.wins = [];
            if (!lb.multiplayer.wins) lb.multiplayer.wins = [];
            return lb;
        }
    } catch (e) {
        console.error('[LEADERBOARD] Error loading:', e);
    }
    return {
        singleplayer: { wins: [], score: [], words: [], longest: [] },
        multiplayer: { wins: [], score: [], words: [], longest: [] }
    };
}

function saveLeaderboard(leaderboard) {
    try {
        fs.writeFileSync(LEADERBOARD_FILE, JSON.stringify(leaderboard, null, 2));
    } catch (e) {
        console.error('[LEADERBOARD] Error saving:', e);
    }
}

let leaderboard = loadLeaderboard();

// --- Item System ---
function loadItemsData() {
    try {
        if (fs.existsSync(ITEMS_FILE)) {
            const data = fs.readFileSync(ITEMS_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (e) {
        console.error('[ITEMS] Error loading:', e);
    }
    return { players: {} };
}

function saveItemsData() {
    try {
        fs.writeFileSync(ITEMS_FILE, JSON.stringify(itemsData, null, 2));
    } catch (e) {
        console.error('[ITEMS] Error saving:', e);
    }
}

let itemsData = loadItemsData();

// ============================================
// Username Validation & Case-Insensitive Lookup
// ============================================

/**
 * Validate username format
 * - No consecutive spaces (single spaces OK)
 * - 1-18 characters after trimming
 */
function isValidUsername(name) {
    if (!name || typeof name !== 'string') return false;
    const trimmed = name.trim();
    if (trimmed.length < 1 || trimmed.length > 18) return false;
    // Check for consecutive spaces
    if (/\s{2,}/.test(trimmed)) return false;
    return true;
}

/**
 * Find a player by name, case-insensitive
 * Returns the canonical (original) name if found, null otherwise
 */
function findPlayerCaseInsensitive(name) {
    if (!name) return null;
    const lowerName = name.toLowerCase();
    for (const playerName of Object.keys(itemsData.players)) {
        if (playerName.toLowerCase() === lowerName) {
            return playerName; // Return the original casing
        }
    }
    return null;
}

/**
 * Get player data by name (case-insensitive)
 * Returns { canonicalName, data } or null
 */
function getPlayerCaseInsensitive(name) {
    const canonicalName = findPlayerCaseInsensitive(name);
    if (!canonicalName) return null;
    return {
        canonicalName,
        data: itemsData.players[canonicalName]
    };
}

// ============================================
// Merge Duplicate Accounts (Run on Startup)
// ============================================
function mergeDuplicateAccounts() {
    const playersByLower = {};
    
    // Group players by lowercase name
    for (const [name, data] of Object.entries(itemsData.players)) {
        const lower = name.toLowerCase();
        if (!playersByLower[lower]) {
            playersByLower[lower] = [];
        }
        playersByLower[lower].push({ name, data });
    }
    
    let mergeCount = 0;
    let skippedCount = 0;
    
    // Find and merge duplicates
    for (const [lowerName, accounts] of Object.entries(playersByLower)) {
        if (accounts.length <= 1) continue;
        
        // Sort by created date (oldest first)
        accounts.sort((a, b) => {
            const dateA = new Date(a.data.created || '2099-01-01');
            const dateB = new Date(b.data.created || '2099-01-01');
            return dateA - dateB;
        });
        
        // Keep the oldest account as canonical
        const canonical = accounts[0];
        const toMerge = accounts.slice(1);
        
        for (const dupe of toMerge) {
            // Only merge if PINs match
            if (canonical.data.pinHash !== dupe.data.pinHash) {
                console.log(`[MERGE] SKIPPED "${dupe.name}" - PIN does not match "${canonical.name}"`);
                skippedCount++;
                continue;
            }
            
            console.log(`[MERGE] PINs match! Merging "${dupe.name}" into "${canonical.name}"`);
            
            // Merge inventories (sum all items)
            for (const item of ITEM_ORDER) {
                canonical.data.inventory[item] = (canonical.data.inventory[item] || 0) + (dupe.data.inventory[item] || 0);
            }
            
            // Merge history (combine and keep newest 20)
            if (dupe.data.history && dupe.data.history.length > 0) {
                canonical.data.history = [...(canonical.data.history || []), ...dupe.data.history];
                canonical.data.history.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
                canonical.data.history = canonical.data.history.slice(0, 20);
            }
            
            // Merge sessions
            if (dupe.data.sessions) {
                canonical.data.sessions = [...new Set([...(canonical.data.sessions || []), ...dupe.data.sessions])];
                canonical.data.sessions = canonical.data.sessions.slice(-10); // Keep last 10
            }
            
            // Update leaderboard entries from dupe name to canonical name
            updateLeaderboardName(dupe.name, canonical.name);
            
            // Delete the duplicate
            delete itemsData.players[dupe.name];
            mergeCount++;
        }
    }
    
    if (mergeCount > 0 || skippedCount > 0) {
        if (mergeCount > 0) {
            saveItemsData();
            saveLeaderboard(leaderboard);
        }
        console.log(`[MERGE] Completed: merged ${mergeCount}, skipped ${skippedCount} (PIN mismatch)`);
    }
}

// Run merge on startup (after leaderboard is loaded - moved to after updateLeaderboardName is defined)

function generateSessionToken() {
    return crypto.randomBytes(32).toString('hex');
}

function hashPin(pin) {
    return crypto.createHash('sha256').update(pin).digest('hex');
}

function rollItem() {
    // First roll: which category?
    const categoryRand = Math.random();
    let categoryCumulative = 0;
    let selectedCategory = null;

    for (const [catName, catData] of Object.entries(ITEM_CATEGORIES)) {
        categoryCumulative += catData.dropRate;
        if (categoryRand < categoryCumulative) {
            selectedCategory = catData;
            break;
        }
    }

    if (!selectedCategory) selectedCategory = ITEM_CATEGORIES.coins; // fallback

    // Second roll: which item within category?
    const itemRand = Math.random();
    let itemCumulative = 0;

    for (const [itemName, itemData] of Object.entries(selectedCategory.items)) {
        itemCumulative += itemData.chance;
        if (itemRand < itemCumulative) {
            return itemName;
        }
    }

    // Fallback to first item in category
    return Object.keys(selectedCategory.items)[0];
}

function rollMultipleItems(count) {
    const rolls = [];
    for (let i = 0; i < count; i++) {
        rolls.push(rollItem());
    }
    return rolls;
}

function getEmptyInventory() {
    return {
        silver_coin: 0,
        gold_coin: 0,
        opal: 0,
        amethyst: 0,
        moonstone: 0,
        ruby: 0,
        sapphire: 0,
        diamond: 0,
        faded_page: 0,
        cursed_amulet: 0
    };
}

function getPlayerData(name) {
    return itemsData.players[name] || null;
}

function createPlayer(name, pin) {
    const sessionToken = generateSessionToken();
    const now = new Date().toISOString();
    itemsData.players[name] = {
        pinHash: hashPin(pin),
        inventory: getEmptyInventory(),
        created: now,
        lastSeen: now,
        sessions: [sessionToken],
        history: []
    };
    saveItemsData();
    return sessionToken;
}

function verifyPin(name, pin) {
    const player = getPlayerData(name);
    if (!player) return { success: false, reason: 'not_found' };
    if (player.pinHash !== hashPin(pin)) return { success: false, reason: 'wrong_pin' };

    // Create new session
    const sessionToken = generateSessionToken();
    player.sessions.push(sessionToken);
    // Keep only last 10 sessions
    if (player.sessions.length > 10) {
        player.sessions = player.sessions.slice(-10);
    }
    player.lastSeen = new Date().toISOString();
    saveItemsData();

    return { success: true, sessionToken, inventory: player.inventory };
}

function verifySession(name, sessionToken) {
    const player = getPlayerData(name);
    if (!player) return { valid: false };
    if (!player.sessions.includes(sessionToken)) return { valid: false };

    player.lastSeen = new Date().toISOString();
    saveItemsData();

    return { valid: true, inventory: player.inventory };
}

function addItemsToPlayer(name, items) {
    const player = getPlayerData(name);
    if (!player) return null;

    for (const item of items) {
        player.inventory[item] = (player.inventory[item] || 0) + 1;
    }
    player.lastSeen = new Date().toISOString();

    // Add to history
    player.history.unshift({
        items: items,
        timestamp: new Date().toISOString()
    });
    // Keep only last 20 history entries
    if (player.history.length > 20) {
        player.history = player.history.slice(0, 20);
    }

    saveItemsData();
    return { inventory: player.inventory };
}

function getRichestPlayers(limit = 20) {
    // Now just returns players with most total items
    const players = Object.entries(itemsData.players)
        .map(([name, data]) => {
            const totalItems = Object.values(data.inventory).reduce((a, b) => a + b, 0);
            return { name, totalItems, inventory: data.inventory };
        })
        .sort((a, b) => b.totalItems - a.totalItems)
        .slice(0, limit);
    return players;
}

// Funny random name generator - meme edition
const NAME_PARTS = {
    prefixes: [
        // Food adjectives
        'Pickle', 'Chunky', 'Soggy', 'Crispy', 'Spicy', 'Greasy', 'Moldy', 'Crusty',
        'Crunchy', 'Salty', 'Moist', 'Stale', 'Burnt', 'Raw', 'Frozen', 'Lukewarm',
        // Personality
        'Funky', 'Sneaky', 'Sweaty', 'Sketchy', 'Shady', 'Sussy', 'Based', 'Cringe',
        'Grumpy', 'Hangry', 'Sleepy', 'Dizzy', 'Cranky', 'Moody', 'Edgy', 'Cursed',
        // Size
        'Chonky', 'Thicc', 'Smol', 'Absolute', 'Mega', 'Ultra', 'Giga', 'Tiny', 'Massive',
        // Titles
        'Captain', 'Doctor', 'Professor', 'Lord', 'Sir', 'King', 'Queen', 'Duke', 'Baron',
        'His Highness', 'Her Majesty', 'Grand', 'Supreme', 'Legendary', 'Epic', 'Mythic',
        // Meme prefixes
        'Big', 'Lil', 'MC', 'DJ', 'El', 'Le', 'Da', 'Xx', 'CEO of',
        // Vibes
        'Feral', 'Chaotic', 'Unhinged', 'Froggy', 'Spooky', 'Goofy', 'Wacky', 'Derpy',
        'Sigma', 'Alpha', 'Beta', 'Omega', 'Gigachad', 'Chad', 'Virgin', 'Boomer',
        'Zoomer', 'NPC', 'Main Character', 'Side Quest', 'Final Boss', 'Tutorial',
        'Certified', 'Professional', 'Amateur', 'Retired', 'Wannabe', 'Bootleg',
        'Discount', 'Walmart', 'Gucci', 'Broke', 'Rich', 'Fancy', 'Bougie'
    ],
    middles: [
        // Food
        'Waffle', 'Nugget', 'Pickle', 'Taco', 'Bean', 'Noodle', 'Potato', 'Biscuit',
        'Donut', 'Burrito', 'Hotdog', 'Muffin', 'Pancake', 'Turnip', 'Cabbage', 'Banana',
        'Cheese', 'Bacon', 'Shrimp', 'Lobster', 'Tendies', 'Nuggies', 'Borger', 'Pizza',
        'Spaghetti', 'Ramen', 'Toast', 'Croissant', 'Bagel', 'Pretzel', 'Nacho', 'Salsa',
        // Animals
        'Goblin', 'Gremlin', 'Hamster', 'Raccoon', 'Possum', 'Goose', 'Moose', 'Chicken',
        'Hawk', 'Cat', 'Doggo', 'Frog', 'Toad', 'Moth', 'Crab', 'Monke', 'Doge', 'Cheems',
        'Shibe', 'Pupper', 'Birb', 'Snek', 'Danger Noodle', 'Murder Hornet', 'Trash Panda',
        'Capybara', 'Quokka', 'Axolotl', 'Blobfish', 'Platypus', 'Llama', 'Alpaca',
        // Characters
        'Cowboy', 'Wizard', 'Ninja', 'Pirate', 'Viking', 'Zombie', 'Vampire', 'Werewolf',
        'Ghost', 'Skeleton', 'Clown', 'Jester', 'Karen', 'Kevin', 'Chad', 'Stacy',
        'Boomer', 'Zoomer', 'Doomer', 'Coomer', 'Gamer', 'Streamer', 'Influencer',
        // Objects
        'Sock', 'Pants', 'Croc', 'Sandal', 'Toilet', 'Dumpster', 'Microwave', 'Toaster',
        'Roomba', 'Printer', 'Nokia', 'Fridge', 'Lamp', 'Chair', 'Table', 'Spoon',
        // Meme words
        'Yeet', 'Bonk', 'Chungus', 'Dingus', 'Bongo', 'Stonks', 'Meme', 'Vine', 'Ratio',
        'Rizz', 'Skibidi', 'Gyatt', 'Ohio', 'Amogus', 'Sus', 'Bruh', 'Oof', 'Poggers',
        // Concepts
        'Chaos', 'Danger', 'Thunder', 'Laser', 'Turbo', 'Crypto', 'Blockchain', 'NFT',
        'Beef', 'Pork', 'Drama', 'Clout', 'Vibe', 'Mood', 'Energy', 'Aura'
    ],
    suffixes: [
        // Titles
        'Master', 'Lord', 'King', 'Queen', 'Prince', 'Princess', 'Emperor', 'Empress',
        'Boy', 'Girl', 'Man', 'Woman', 'Dude', 'Bro', 'Guy', 'Lad', 'Lass',
        // Actions
        'Slayer', 'Destroyer', 'Hunter', 'Lover', 'Whisperer', 'Wrangler', 'Tamer',
        'Yeeter', 'Bonker', 'Enjoyer', 'Appreciator', 'Connoisseur', 'Enthusiast',
        'Hater', 'Stan', 'Simp', 'Respecter', 'Ignorer', 'Denier', 'Believer',
        // Status
        'Monster', 'Gamer', 'Legend', 'Champion', 'Warrior', 'Knight', 'Bandit',
        'Demon', 'Angel', 'God', 'Goddess', 'Saint', 'Sinner', 'Hero', 'Villain',
        'Main Character', 'NPC', 'Boss', 'Minion', 'Intern', 'Manager', 'CEO',
        // Qualifiers
        'Express', 'Deluxe', 'Supreme', 'Prime', 'Ultra', 'Xtreme', 'Pro', 'Max',
        'Jr', 'Sr', 'III', 'TheGreat', 'TheMagnificent', 'TheWise', 'TheBold',
        'Official', 'Real', 'Actual', 'Original', 'Fake', 'Bootleg', 'Generic',
        '9000', '3000', '2000', 'Remastered', 'Deluxe Edition', 'GOTY'
    ],
    funnyNumbers: [
        '69', '420', '666', '1337', '42', '99', '007', '2024', '2025', '911',
        '360', '404', '80085', '5318008', '8008', '1234', '0', '1', '100',
        '9000', '3000', '2077', '1984', '2012', '21', '7', '13', '777'
    ]
};

function generateName() {
    const patterns = [
        // PrefixMiddle69
        () => {
            const pre = NAME_PARTS.prefixes[Math.floor(Math.random() * NAME_PARTS.prefixes.length)];
            const mid = NAME_PARTS.middles[Math.floor(Math.random() * NAME_PARTS.middles.length)];
            const num = NAME_PARTS.funnyNumbers[Math.floor(Math.random() * NAME_PARTS.funnyNumbers.length)];
            return `${pre}${mid}${num}`;
        },
        // MiddleSuffix
        () => {
            const mid = NAME_PARTS.middles[Math.floor(Math.random() * NAME_PARTS.middles.length)];
            const suf = NAME_PARTS.suffixes[Math.floor(Math.random() * NAME_PARTS.suffixes.length)];
            return `${mid}${suf}`;
        },
        // PrefixMiddleSuffix
        () => {
            const pre = NAME_PARTS.prefixes[Math.floor(Math.random() * NAME_PARTS.prefixes.length)];
            const mid = NAME_PARTS.middles[Math.floor(Math.random() * NAME_PARTS.middles.length)];
            const suf = NAME_PARTS.suffixes[Math.floor(Math.random() * NAME_PARTS.suffixes.length)];
            return `${pre}${mid}${suf}`;
        },
        // xXMiddleXx style
        () => {
            const mid = NAME_PARTS.middles[Math.floor(Math.random() * NAME_PARTS.middles.length)];
            const num = NAME_PARTS.funnyNumbers[Math.floor(Math.random() * NAME_PARTS.funnyNumbers.length)];
            return `xX${mid}${num}Xx`;
        },
        // Middle_Middle69
        () => {
            const mid1 = NAME_PARTS.middles[Math.floor(Math.random() * NAME_PARTS.middles.length)];
            const mid2 = NAME_PARTS.middles[Math.floor(Math.random() * NAME_PARTS.middles.length)];
            const num = NAME_PARTS.funnyNumbers[Math.floor(Math.random() * NAME_PARTS.funnyNumbers.length)];
            return `${mid1}_${mid2}${num}`;
        },
        // TheRealMiddle
        () => {
            const mid = NAME_PARTS.middles[Math.floor(Math.random() * NAME_PARTS.middles.length)];
            const pre = ['TheReal', 'NotA', 'Definitely', 'Literally', 'Actually', 'Secret', 'Fake', 'Certified', 'Licensed'][Math.floor(Math.random() * 9)];
            return `${pre}${mid}`;
        },
        // MiddleEnjoyer / MiddleHater
        () => {
            const mid = NAME_PARTS.middles[Math.floor(Math.random() * NAME_PARTS.middles.length)];
            const suf = ['Enjoyer', 'Appreciator', 'Hater', 'Stan', 'Simp', 'Denier', 'Believer', 'Respecter'][Math.floor(Math.random() * 8)];
            return `${mid}${suf}`;
        },
        // CEO of Middle
        () => {
            const mid = NAME_PARTS.middles[Math.floor(Math.random() * NAME_PARTS.middles.length)];
            const title = ['CEO of', 'President of', 'Duke of', 'Lord of', 'King of', 'God of'][Math.floor(Math.random() * 6)];
            return `${title} ${mid}`;
        }
    ];

    const pattern = patterns[Math.floor(Math.random() * patterns.length)];
    return pattern().substring(0, 20); // Cap at 20 chars
}

// Boggle dice (4x4)
const DICE_4x4 = [
    ['A', 'A', 'E', 'E', 'G', 'N'], ['A', 'B', 'B', 'J', 'O', 'O'],
    ['A', 'C', 'H', 'O', 'P', 'S'], ['A', 'F', 'F', 'K', 'P', 'S'],
    ['A', 'O', 'O', 'T', 'T', 'W'], ['C', 'I', 'M', 'O', 'T', 'U'],
    ['D', 'E', 'I', 'L', 'R', 'X'], ['D', 'E', 'L', 'R', 'V', 'Y'],
    ['D', 'I', 'S', 'T', 'T', 'Y'], ['E', 'E', 'G', 'H', 'N', 'W'],
    ['E', 'E', 'I', 'N', 'S', 'U'], ['E', 'H', 'R', 'T', 'V', 'W'],
    ['E', 'I', 'O', 'S', 'S', 'T'], ['E', 'L', 'R', 'T', 'T', 'Y'],
    ['H', 'I', 'M', 'N', 'U', 'Qu'], ['H', 'L', 'N', 'N', 'R', 'Z']
];

function generateBoard() {
    const shuffled = [...DICE_4x4].sort(() => Math.random() - 0.5);
    return shuffled.map(die => die[Math.floor(Math.random() * 6)]);
}

// Score calculation
const SCORE_TABLE = { 3: 1, 4: 1, 5: 2, 6: 3, 7: 5 };
function getWordScore(len) {
    return len >= 8 ? 11 : (SCORE_TABLE[len] || 0);
}

// Game state
const waitingPlayersCasual = [];
const waitingPlayersWager = [];
const activeGames = new Map();
const playerToGame = new Map();
const disconnectedPlayers = new Map(); // playerId -> { game, playerIndex, timeout, name, words }

const wss = new WebSocket.Server({ port: PORT });

console.log(`[SERVER] Boggle multiplayer server running on port ${PORT}`);

wss.on('connection', (ws) => {
    const playerId = `player_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    ws.playerId = playerId;
    ws.playerName = null; // Set later when needed (login or game queue)
    ws.isAlive = true;

    // Send welcome with just the player ID
    ws.send(JSON.stringify({
        type: 'welcome',
        playerId: playerId
    }));

    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data);
            handleMessage(ws, msg);
        } catch (e) {
            console.error('[ERROR] Invalid message:', e);
        }
    });

    ws.on('close', () => {
        // Only log if they had a name (were actually doing something)
        if (ws.playerName) {
            console.log(`[DISCONNECT] ${ws.playerName}`);
        }
        handleDisconnect(ws);
    });

    ws.on('error', (err) => {
        console.error(`[ERROR] ${ws.playerName || ws.playerId}:`, err.message);
    });
});

// Heartbeat to detect dead connections
const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (!ws.isAlive) {
            console.log(`[TIMEOUT] ${ws.playerName}`);
            return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
    });
}, 1000); // Check every 1 second for instant disconnect detection

wss.on('close', () => clearInterval(interval));

function handleMessage(ws, msg) {
    switch (msg.type) {
        case 'set_name':
            const newName = (msg.name || '').trim().substring(0, 20);
            if (newName) {
                if (ws.playerName && ws.playerName !== newName) {
                    console.log(`[RENAME] ${ws.playerName} -> ${newName}`);
                }
                ws.playerName = newName;
                ws.send(JSON.stringify({ type: 'name_updated', name: newName }));
            }
            break;

        case 'find_game':
            handleFindGame(ws, msg.wagerMode || false);
            break;

        case 'cancel_search':
            handleCancelSearch(ws);
            break;

        case 'submit_words':
            handleSubmitWords(ws, msg.words || []);
            break;

        case 'reconnect':
            handleReconnect(ws, msg.gameId, msg.playerId);
            break;

        case 'get_leaderboard':
            handleGetLeaderboard(ws, msg.mode, msg.game);
            break;

        case 'submit_score':
            handleSubmitScore(ws, msg);
            break;

        // --- Item System Messages ---
        case 'check_name':
            handleCheckName(ws, msg.name);
            break;

        case 'create_pin':
            handleCreatePin(ws, msg.name, msg.pin);
            break;

        case 'verify_pin':
            handleVerifyPin(ws, msg.name, msg.pin);
            break;

        case 'verify_session':
            handleVerifySession(ws, msg.name, msg.sessionToken);
            break;

        case 'change_name':
            handleChangeName(ws, msg.oldName, msg.newName, msg.pin, msg.sessionToken);
            break;

        case 'get_inventory':
            handleGetInventory(ws, msg.name, msg.sessionToken);
            break;

        case 'roll_items':
            handleRollItems(ws, msg.name, msg.sessionToken, msg.rolls, msg.words);
            break;

        case 'get_richest':
            handleGetRichest(ws);
            break;

        // --- Wager System Messages ---
        case 'update_wager':
            handleUpdateWager(ws, msg.gameId, msg.wager);
            break;

        case 'confirm_wager':
            handleConfirmWager(ws, msg.gameId, msg.wager);
            break;

        case 'leave_wager':
            handleLeaveWager(ws, msg.gameId);
            break;

        case 'player_ready':
            handlePlayerReady(ws, msg.gameId);
            break;

        case 'cancel_ready':
            handleCancelReady(ws, msg.gameId);
            break;

        // --- Scrabble Game Messages ---
        case 'scrabble_get_games':
            handleScrabbleGetGames(ws, msg.playerName);
            break;

        case 'scrabble_create_game':
            handleScrabbleCreateGame(ws, msg.playerName, msg.opponent, msg.isNPC);
            break;

        case 'scrabble_load_game':
            handleScrabbleLoadGame(ws, msg.gameId, msg.playerName);
            break;

        case 'scrabble_play_move':
            handleScrabblePlayMove(ws, msg.gameId, msg.playerName, msg.placedTiles, msg.score);
            break;

        case 'scrabble_pass_turn':
            handleScrabblePassTurn(ws, msg.gameId, msg.playerName);
            break;

        default:
            console.log(`[UNKNOWN] ${msg.type} from ${ws.playerName}`);
    }
}

function handleFindGame(ws, wagerMode = false) {
    // Check if already in queue or game
    const inCasual = waitingPlayersCasual.includes(ws);
    const inWager = waitingPlayersWager.includes(ws);
    if (inCasual || inWager) {
        ws.send(JSON.stringify({ type: 'error', message: 'Already searching' }));
        return;
    }
    if (playerToGame.has(ws.playerId)) {
        ws.send(JSON.stringify({ type: 'error', message: 'Already in game' }));
        return;
    }

    // Generate a name if they don't have one yet (not logged in)
    if (!ws.playerName) {
        ws.playerName = generateName();
    }

    ws.wagerMode = wagerMode;
    const queue = wagerMode ? waitingPlayersWager : waitingPlayersCasual;
    const queueName = wagerMode ? 'wager' : 'casual';

    console.log(`[QUEUE] ${ws.playerName} looking for ${queueName} game`);

    if (queue.length > 0) {
        // Match with waiting player
        const opponent = queue.shift();
        startGame(ws, opponent, wagerMode);
    } else {
        // Add to queue
        queue.push(ws);
        ws.send(JSON.stringify({ type: 'searching' }));
    }
}

function handleCancelSearch(ws) {
    let idx = waitingPlayersCasual.indexOf(ws);
    if (idx !== -1) {
        waitingPlayersCasual.splice(idx, 1);
        console.log(`[CANCEL] ${ws.playerName} left casual queue`);
        ws.send(JSON.stringify({ type: 'search_cancelled' }));
        return;
    }
    idx = waitingPlayersWager.indexOf(ws);
    if (idx !== -1) {
        waitingPlayersWager.splice(idx, 1);
        console.log(`[CANCEL] ${ws.playerName} left wager queue`);
        ws.send(JSON.stringify({ type: 'search_cancelled' }));
    }
}

function startGame(player1, player2, wagerMode = false) {
    const gameId = `game_${Date.now()}`;
    const board = generateBoard();

    const emptyWager = () => ({ silver_coin: 0, gold_coin: 0, opal: 0, amethyst: 0, moonstone: 0, ruby: 0, sapphire: 0, diamond: 0, faded_page: 0, cursed_amulet: 0 });

    const game = {
        id: gameId,
        board: board,
        startTime: null,
        endTime: null,
        wagerMode: wagerMode,
        players: [
            { ws: player1, id: player1.playerId, name: player1.playerName, words: null, connected: true, wager: emptyWager(), wagerConfirmed: false, ready: false },
            { ws: player2, id: player2.playerId, name: player2.playerName, words: null, connected: true, wager: emptyWager(), wagerConfirmed: false, ready: false }
        ],
        status: wagerMode ? 'wager' : 'countdown', // Skip wager phase if casual
        paused: false,
        pausedAt: null,
        pausedTimeRemaining: null
    };

    activeGames.set(gameId, game);
    playerToGame.set(player1.playerId, gameId);
    playerToGame.set(player2.playerId, gameId);

    const modeStr = wagerMode ? 'wager' : 'casual';
    console.log(`[GAME MATCHED] ${gameId}: ${player1.playerName} vs ${player2.playerName} (${modeStr})`);

    // Notify both players
    const gameStartMsg = {
        type: 'game_matched',
        gameId: gameId,
        board: board,
        duration: GAME_TIME,
        wagerMode: wagerMode,
        opponent: null
    };

    player1.send(JSON.stringify({ ...gameStartMsg, opponent: player2.playerName }));
    player2.send(JSON.stringify({ ...gameStartMsg, opponent: player1.playerName }));

    // If casual mode, skip wager and start countdown immediately
    if (!wagerMode) {
        startCountdownPhase(game);
    }
}

function startCountdownPhase(game) {
    const countdownSeconds = 3;
    game.status = 'countdown';

    console.log(`[GAME COUNTDOWN] ${game.id}: Starting countdown`);

    // Send countdown ticks
    for (let i = countdownSeconds; i >= 1; i--) {
        setTimeout(() => {
            if (activeGames.has(game.id) && game.status === 'countdown') {
                broadcastToGame(game, { type: 'countdown_tick', seconds: i });
            }
        }, (countdownSeconds - i) * 1000);
    }

    // Set game to active after countdown
    setTimeout(() => {
        if (activeGames.has(game.id) && game.status === 'countdown') {
            game.status = 'active';
            game.startTime = Date.now();
            game.endTime = Date.now() + (GAME_TIME * 1000);
            console.log(`[GAME ACTIVE] ${game.id}`);
            broadcastToGame(game, { type: 'game_start', duration: GAME_TIME });
        }
    }, countdownSeconds * 1000);

    // Auto-end game after time + grace period
    setTimeout(() => {
        if (activeGames.has(game.id) && game.status !== 'finished') {
            console.log(`[GAME TIMEOUT] ${game.id}`);
            finishGame(game.id);
        }
    }, (GAME_TIME + 15) * 1000 + (countdownSeconds * 1000));
}

// --- Wager Handlers ---
function handleUpdateWager(ws, gameId, wager) {
    const game = activeGames.get(gameId);
    if (!game || game.status !== 'wager') return;

    const playerIndex = game.players.findIndex(p => p.id === ws.playerId);
    if (playerIndex === -1) return;

    game.players[playerIndex].wager = wager;

    // Notify opponent
    const opponent = game.players[1 - playerIndex];
    if (opponent.connected && opponent.ws.readyState === WebSocket.OPEN) {
        opponent.ws.send(JSON.stringify({
            type: 'wager_updated',
            wager: wager
        }));
    }
}

function handleConfirmWager(ws, gameId, wager) {
    const game = activeGames.get(gameId);
    if (!game || game.status !== 'wager') return;

    const playerIndex = game.players.findIndex(p => p.id === ws.playerId);
    if (playerIndex === -1) return;

    const player = game.players[playerIndex];
    player.wager = wager;
    player.wagerConfirmed = true;

    // Deduct wagered items from player's inventory
    const playerData = getPlayerData(player.name);
    if (playerData) {
        const ITEM_ORDER = ['silver_coin', 'gold_coin', 'opal', 'amethyst', 'moonstone', 'ruby', 'sapphire', 'diamond', 'faded_page', 'cursed_amulet'];
        ITEM_ORDER.forEach(item => {
            if (wager[item] > 0) {
                playerData.inventory[item] = Math.max(0, (playerData.inventory[item] || 0) - wager[item]);
            }
        });
        saveItemsData();
        console.log(`[WAGER] ${player.name} wagered items deducted from inventory`);
    }

    console.log(`[WAGER] ${player.name} confirmed wager in ${gameId}`);

    // Notify opponent
    const opponent = game.players[1 - playerIndex];
    if (opponent.connected && opponent.ws.readyState === WebSocket.OPEN) {
        opponent.ws.send(JSON.stringify({ type: 'opponent_wager_confirmed' }));
    }

    // Check if both confirmed
    if (game.players[0].wagerConfirmed && game.players[1].wagerConfirmed) {
        game.status = 'ready';
        console.log(`[WAGER] Both confirmed in ${gameId}, moving to ready phase`);

        // Send locked wagers to both players
        game.players.forEach((p, i) => {
            const opp = game.players[1 - i];
            if (p.connected && p.ws.readyState === WebSocket.OPEN) {
                p.ws.send(JSON.stringify({
                    type: 'wagers_locked',
                    myWager: p.wager,
                    oppWager: opp.wager
                }));
            }
        });
    }
}

function handleLeaveWager(ws, gameId) {
    const game = activeGames.get(gameId);
    if (!game) return;

    const playerIndex = game.players.findIndex(p => p.id === ws.playerId);
    if (playerIndex === -1) return;

    console.log(`[WAGER] ${ws.playerName} left wager in ${gameId}`);

    // Return wagered items to both players if they confirmed
    const ITEM_ORDER = ['silver_coin', 'gold_coin', 'opal', 'amethyst', 'moonstone', 'ruby', 'sapphire', 'diamond', 'faded_page', 'cursed_amulet'];
    game.players.forEach(p => {
        if (p.wagerConfirmed) {
            const playerData = getPlayerData(p.name);
            if (playerData) {
                ITEM_ORDER.forEach(item => {
                    playerData.inventory[item] = (playerData.inventory[item] || 0) + (p.wager[item] || 0);
                });
                console.log(`[WAGER] Returned items to ${p.name}`);
            }
        }
    });
    saveItemsData();

    // Notify opponent
    const opponent = game.players[1 - playerIndex];
    if (opponent.connected && opponent.ws.readyState === WebSocket.OPEN) {
        opponent.ws.send(JSON.stringify({ type: 'opponent_cancelled_wager' }));
    }

    // Clean up game
    game.players.forEach(p => playerToGame.delete(p.id));
    activeGames.delete(gameId);
}

function handlePlayerReady(ws, gameId) {
    const game = activeGames.get(gameId);
    if (!game || game.status !== 'ready') return;

    const playerIndex = game.players.findIndex(p => p.id === ws.playerId);
    if (playerIndex === -1) return;

    game.players[playerIndex].ready = true;
    console.log(`[READY] ${ws.playerName} is ready in ${gameId}`);

    // Notify opponent
    const opponent = game.players[1 - playerIndex];
    if (opponent.connected && opponent.ws.readyState === WebSocket.OPEN) {
        opponent.ws.send(JSON.stringify({ type: 'opponent_ready' }));
    }

    // Check if both ready
    if (game.players[0].ready && game.players[1].ready) {
        console.log(`[READY] Both ready in ${gameId}, starting countdown`);
        broadcastToGame(game, { type: 'both_ready', countdown: 3 });
        startCountdownPhase(game);
    }
}

function handleCancelReady(ws, gameId) {
    const game = activeGames.get(gameId);
    if (!game) return;

    const playerIndex = game.players.findIndex(p => p.id === ws.playerId);
    if (playerIndex === -1) return;

    console.log(`[READY] ${ws.playerName} cancelled ready in ${gameId}`);

    // Return wagered items to both players
    const ITEM_ORDER = ['silver_coin', 'gold_coin', 'opal', 'amethyst', 'moonstone', 'ruby', 'sapphire', 'diamond', 'faded_page', 'cursed_amulet'];
    game.players.forEach(p => {
        if (p.wagerConfirmed) {
            const playerData = getPlayerData(p.name);
            if (playerData) {
                ITEM_ORDER.forEach(item => {
                    playerData.inventory[item] = (playerData.inventory[item] || 0) + (p.wager[item] || 0);
                });
                console.log(`[WAGER] Returned items to ${p.name}`);
            }
        }
    });
    saveItemsData();

    // Notify opponent
    const opponent = game.players[1 - playerIndex];
    if (opponent.connected && opponent.ws.readyState === WebSocket.OPEN) {
        opponent.ws.send(JSON.stringify({ type: 'opponent_cancelled_wager' }));
    }

    // Clean up game
    game.players.forEach(p => playerToGame.delete(p.id));
    activeGames.delete(gameId);
}

function broadcastToGame(game, msg) {
    const msgStr = JSON.stringify(msg);
    game.players.forEach(p => {
        if (p.connected && p.ws.readyState === WebSocket.OPEN) {
            p.ws.send(msgStr);
        }
    });
}

function handleReconnect(ws, gameId, oldPlayerId) {
    console.log(`[RECONNECT ATTEMPT] gameId: ${gameId}, oldPlayerId: ${oldPlayerId}`);
    console.log(`[RECONNECT DEBUG] Active games: ${[...activeGames.keys()].join(', ') || 'none'}`);
    console.log(`[RECONNECT DEBUG] Disconnected players: ${[...disconnectedPlayers.keys()].join(', ') || 'none'}`);

    const game = activeGames.get(gameId);
    if (!game) {
        console.log(`[RECONNECT FAIL] Game ${gameId} not found in active games`);
        ws.send(JSON.stringify({ type: 'reconnect_failed', reason: 'Game not found or already ended' }));
        return;
    }

    console.log(`[RECONNECT DEBUG] Game status: ${game.status}, players: ${game.players.map(p => p.id).join(', ')}`);

    // Find the player in this game
    const playerIndex = game.players.findIndex(p => p.id === oldPlayerId);
    if (playerIndex === -1) {
        console.log(`[RECONNECT FAIL] Player ${oldPlayerId} not in game ${gameId}. Game players: ${game.players.map(p => p.id).join(', ')}`);
        ws.send(JSON.stringify({ type: 'reconnect_failed', reason: 'Player not in game' }));
        return;
    }

    const player = game.players[playerIndex];
    const opponent = game.players[1 - playerIndex];

    // Clear any pending disconnect timeout
    const disconnectInfo = disconnectedPlayers.get(oldPlayerId);
    if (disconnectInfo && disconnectInfo.timeout) {
        clearTimeout(disconnectInfo.timeout);
        disconnectedPlayers.delete(oldPlayerId);
    }

    // Restore player connection
    player.ws = ws;
    player.connected = true;
    ws.playerId = oldPlayerId;
    ws.playerName = player.name;
    playerToGame.set(oldPlayerId, gameId);

    console.log(`[RECONNECT SUCCESS] ${player.name} rejoined game ${gameId}`);

    // Calculate remaining time
    let timeRemaining;
    if (game.paused && game.pausedTimeRemaining !== null) {
        timeRemaining = game.pausedTimeRemaining;
    } else {
        timeRemaining = Math.max(0, Math.floor((game.endTime - Date.now()) / 1000));
    }

    // Send reconnect success with game state
    ws.send(JSON.stringify({
        type: 'reconnect_success',
        gameId: gameId,
        board: game.board,
        timeRemaining: timeRemaining,
        opponent: opponent.name,
        paused: game.paused,
        words: disconnectInfo?.words || []
    }));

    // If game was paused because of this player, resume it
    if (game.paused && !opponent.connected) {
        // Other player still disconnected, stay paused
        ws.send(JSON.stringify({ type: 'game_paused', reason: 'Opponent disconnected' }));
    } else if (game.paused) {
        // Both players now connected, resume game
        resumeGame(game);
    }

    // Notify opponent that player reconnected
    if (opponent.connected && opponent.ws.readyState === WebSocket.OPEN) {
        opponent.ws.send(JSON.stringify({ type: 'opponent_reconnected' }));
    }
}

function pauseGame(game, disconnectedPlayerName) {
    if (game.paused) return;

    game.paused = true;
    game.pausedAt = Date.now();
    game.pausedTimeRemaining = Math.max(0, Math.floor((game.endTime - Date.now()) / 1000));

    console.log(`[GAME PAUSED] ${game.id} - ${disconnectedPlayerName} disconnected, ${game.pausedTimeRemaining}s remaining`);

    // Notify connected players
    game.players.forEach(p => {
        if (p.connected && p.ws.readyState === WebSocket.OPEN) {
            p.ws.send(JSON.stringify({
                type: 'game_paused',
                reason: `${disconnectedPlayerName} disconnected`,
                timeRemaining: game.pausedTimeRemaining
            }));
        }
    });
}

function resumeGame(game) {
    if (!game.paused) return;

    const countdownSeconds = 3;
    const timeRemaining = game.pausedTimeRemaining;

    console.log(`[GAME RESUMING] ${game.id} - ${countdownSeconds}s countdown, then ${timeRemaining}s remaining`);

    // Notify all players that we're about to resume
    broadcastToGame(game, {
        type: 'game_resuming',
        countdown: countdownSeconds,
        timeRemaining: timeRemaining
    });

    // Send countdown ticks
    for (let i = countdownSeconds; i >= 1; i--) {
        setTimeout(() => {
            if (game.paused) { // Still in resume countdown
                broadcastToGame(game, { type: 'countdown_tick', seconds: i });
            }
        }, (countdownSeconds - i) * 1000);
    }

    // Actually resume after countdown
    setTimeout(() => {
        if (!game.paused) return; // Already resumed or cancelled

        game.endTime = Date.now() + (timeRemaining * 1000);
        game.paused = false;
        game.pausedAt = null;
        game.pausedTimeRemaining = null;

        console.log(`[GAME RESUMED] ${game.id} - ${timeRemaining}s remaining`);

        broadcastToGame(game, {
            type: 'game_resumed',
            timeRemaining: timeRemaining
        });
    }, countdownSeconds * 1000);
}

function handleSubmitWords(ws, words) {
    const gameId = playerToGame.get(ws.playerId);
    if (!gameId) {
        ws.send(JSON.stringify({ type: 'error', message: 'Not in a game' }));
        return;
    }

    const game = activeGames.get(gameId);
    if (!game) return;

    // Find this player in the game
    const player = game.players.find(p => p.id === ws.playerId);
    if (!player) return;

    // Store words (uppercase, deduplicated)
    player.words = [...new Set(words.map(w => w.toUpperCase()))];
    console.log(`[SUBMIT] ${ws.playerName} submitted ${player.words.length} words`);

    // Check if both players have submitted
    if (game.players.every(p => p.words !== null)) {
        finishGame(gameId);
    }
}

function finishGame(gameId) {
    const game = activeGames.get(gameId);
    if (!game || game.status === 'finished') return;

    game.status = 'finished';
    console.log(`[GAME END] ${gameId}`);

    // Get word lists (empty array if player didn't submit)
    const p1Words = game.players[0].words || [];
    const p2Words = game.players[1].words || [];

    // Find shared words
    const shared = new Set(p1Words.filter(w => p2Words.includes(w)));

    // Calculate scores
    const p1Results = calculateResults(p1Words, shared);
    const p2Results = calculateResults(p2Words, shared);

    // Determine winner
    let winner = null;
    let winnerIndex = -1;
    if (p1Results.score > p2Results.score) {
        winner = game.players[0].name;
        winnerIndex = 0;
    } else if (p2Results.score > p1Results.score) {
        winner = game.players[1].name;
        winnerIndex = 1;
    }

    // Calculate pot (combined wagers)
    const pot = { silver_coin: 0, gold_coin: 0, opal: 0, amethyst: 0, moonstone: 0, ruby: 0, sapphire: 0, diamond: 0, faded_page: 0, cursed_amulet: 0 };
    const ITEM_ORDER = ['silver_coin', 'gold_coin', 'opal', 'amethyst', 'moonstone', 'ruby', 'sapphire', 'diamond', 'faded_page', 'cursed_amulet'];

    ITEM_ORDER.forEach(item => {
        pot[item] = (game.players[0].wager[item] || 0) + (game.players[1].wager[item] || 0);
    });

    // Check if there was a wager
    const hasWager = ITEM_ORDER.some(item => pot[item] > 0);

    // Distribute wager winnings
    let wagerResult = null;
    if (hasWager && winnerIndex !== -1) {
        const winnerName = game.players[winnerIndex].name;
        const winnerData = getPlayerData(winnerName);

        if (winnerData) {
            // Add pot to winner's inventory
            ITEM_ORDER.forEach(item => {
                winnerData.inventory[item] = (winnerData.inventory[item] || 0) + pot[item];
            });
            saveItemsData();
            console.log(`[WAGER] ${winnerName} won pot:`, pot);
        }

        wagerResult = {
            winner: winnerName,
            pot: pot
        };
    } else if (hasWager && winnerIndex === -1) {
        // Tie - return wagers to each player
        game.players.forEach(p => {
            const playerData = getPlayerData(p.name);
            if (playerData) {
                ITEM_ORDER.forEach(item => {
                    playerData.inventory[item] = (playerData.inventory[item] || 0) + (p.wager[item] || 0);
                });
            }
        });
        saveItemsData();
        console.log(`[WAGER] Tie - wagers returned`);

        wagerResult = {
            winner: null,
            pot: pot,
            returned: true
        };
    }

    // Send results to both players
    const resultsBase = {
        type: 'game_end',
        winner: winner,
        sharedWords: [...shared],
        wagerResult: wagerResult
    };

    const p1Msg = {
        ...resultsBase,
        you: { name: game.players[0].name, ...p1Results },
        opponent: { name: game.players[1].name, ...p2Results }
    };

    const p2Msg = {
        ...resultsBase,
        you: { name: game.players[1].name, ...p2Results },
        opponent: { name: game.players[0].name, ...p1Results }
    };

    if (game.players[0].connected && game.players[0].ws.readyState === WebSocket.OPEN) {
        game.players[0].ws.send(JSON.stringify(p1Msg));
    }
    if (game.players[1].connected && game.players[1].ws.readyState === WebSocket.OPEN) {
        game.players[1].ws.send(JSON.stringify(p2Msg));
    }

    // Cleanup
    cleanupGame(gameId);
}

function cleanupGame(gameId) {
    const game = activeGames.get(gameId);
    if (game) {
        game.players.forEach(p => {
            playerToGame.delete(p.id);
            disconnectedPlayers.delete(p.id);
        });
        activeGames.delete(gameId);
    }
}

function calculateResults(words, sharedWords) {
    let score = 0;
    const scoredWords = words.map(word => {
        const isShared = sharedWords.has(word);
        const pts = isShared ? 0 : getWordScore(word.length);
        score += pts;
        return { word, points: pts, shared: isShared };
    });

    // Sort by length desc, then alphabetically
    scoredWords.sort((a, b) => b.word.length - a.word.length || a.word.localeCompare(b.word));

    return {
        words: scoredWords,
        score: score,
        wordCount: words.length
    };
}

function handleDisconnect(ws) {
    // Remove from waiting queues
    let queueIdx = waitingPlayersCasual.indexOf(ws);
    if (queueIdx !== -1) {
        waitingPlayersCasual.splice(queueIdx, 1);
    }
    queueIdx = waitingPlayersWager.indexOf(ws);
    if (queueIdx !== -1) {
        waitingPlayersWager.splice(queueIdx, 1);
    }

    // Handle active game
    const gameId = playerToGame.get(ws.playerId);
    if (gameId) {
        const game = activeGames.get(gameId);
        if (game && game.status !== 'finished') {
            // Find this player and opponent
            const playerIndex = game.players.findIndex(p => p.id === ws.playerId);
            if (playerIndex === -1) return;

            const player = game.players[playerIndex];
            const opponent = game.players[1 - playerIndex];

            player.connected = false;

            // Store disconnect info for potential reconnect
            disconnectedPlayers.set(ws.playerId, {
                gameId: gameId,
                playerIndex: playerIndex,
                name: player.name,
                words: player.words || [],
                timeout: setTimeout(() => {
                    // Grace period expired
                    console.log(`[RECONNECT EXPIRED] ${player.name} did not reconnect in time`);
                    disconnectedPlayers.delete(ws.playerId);

                    // Notify opponent and end game
                    if (opponent.connected && opponent.ws.readyState === WebSocket.OPEN) {
                        opponent.ws.send(JSON.stringify({
                            type: 'opponent_left',
                            reason: 'Opponent did not reconnect'
                        }));
                    }

                    // End the game
                    finishGame(gameId);
                }, RECONNECT_GRACE_PERIOD)
            });

            // Pause the game
            pauseGame(game, player.name);

            // Notify opponent
            if (opponent.connected && opponent.ws.readyState === WebSocket.OPEN) {
                opponent.ws.send(JSON.stringify({
                    type: 'opponent_disconnected',
                    canReconnect: true,
                    gracePeriod: RECONNECT_GRACE_PERIOD / 1000
                }));
            }
        }
    }

    // DON'T delete playerToGame here - we need it for reconnection
    // It gets cleaned up when the game ends or grace period expires
}

// Log server stats periodically
setInterval(() => {
    console.log(`[STATS] Connections: ${wss.clients.size}, Casual Queue: ${waitingPlayersCasual.length}, Wager Queue: ${waitingPlayersWager.length}, Active Games: ${activeGames.size}, Disconnected: ${disconnectedPlayers.size}`);
}, 60000);

// --- Leaderboard Functions ---
function handleGetLeaderboard(ws, mode, game) {
    const validModes = ['singleplayer', 'multiplayer'];
    const m = validModes.includes(mode) ? mode : 'singleplayer';
    const g = game || 'boggle';

    ws.send(JSON.stringify({
        type: 'leaderboard_data',
        mode: m,
        game: g,
        data: leaderboard[m]
    }));
}

function handleSubmitScore(ws, msg) {
    const { mode, name, score, wordCount, longestWord, gridSize, difficulty, won } = msg;

    if (!name || typeof score !== 'number') {
        ws.send(JSON.stringify({ type: 'score_error', message: 'Invalid score data' }));
        return;
    }

    const validModes = ['singleplayer', 'multiplayer'];
    const m = validModes.includes(mode) ? mode : 'singleplayer';
    const cleanName = String(name).substring(0, 18);
    const date = new Date().toISOString();
    const playerWon = won !== undefined ? won : true;
    const grid = gridSize || 4;
    const diff = difficulty || 'medium';

    console.log(`[LEADERBOARD] ${cleanName} submitted: ${score} pts, ${wordCount} words, longest: ${longestWord}, won: ${playerWon} (${m})`);

    // --- Update Wins/Losses ---
    // Find existing entry for this player + difficulty + gridSize combo
    let winsEntry = leaderboard[m].wins.find(e =>
        e.name === cleanName && e.difficulty === diff && e.gridSize === grid
    );

    if (!winsEntry) {
        // Create new entry
        winsEntry = {
            name: cleanName,
            wins: 0,
            losses: 0,
            difficulty: diff,
            gridSize: grid,
            lastPlayed: date
        };
        leaderboard[m].wins.push(winsEntry);
    }

    // Update wins or losses
    if (playerWon) {
        winsEntry.wins++;
    } else {
        winsEntry.losses++;
    }
    winsEntry.lastPlayed = date;

    // Sort wins leaderboard by wins desc, then win rate
    leaderboard[m].wins.sort((a, b) => {
        if (b.wins !== a.wins) return b.wins - a.wins;
        const aRate = a.wins / (a.wins + a.losses) || 0;
        const bRate = b.wins / (b.wins + b.losses) || 0;
        return bRate - aRate;
    });

    // --- Add to score leaderboard ---
    leaderboard[m].score.push({
        name: cleanName,
        value: score,
        gridSize: grid,
        difficulty: diff,
        date
    });
    leaderboard[m].score.sort((a, b) => b.value - a.value);
    leaderboard[m].score = leaderboard[m].score.slice(0, MAX_LEADERBOARD_ENTRIES);

    // --- Add to word count leaderboard ---
    if (typeof wordCount === 'number') {
        leaderboard[m].words.push({
            name: cleanName,
            value: wordCount,
            gridSize: grid,
            difficulty: diff,
            date
        });
        leaderboard[m].words.sort((a, b) => b.value - a.value);
        leaderboard[m].words = leaderboard[m].words.slice(0, MAX_LEADERBOARD_ENTRIES);
    }

    // --- Add to longest word leaderboard ---
    if (longestWord && longestWord.length >= 3) {
        leaderboard[m].longest.push({
            name: cleanName,
            value: longestWord.length,
            word: longestWord.toUpperCase(),
            gridSize: grid,
            difficulty: diff,
            date
        });
        leaderboard[m].longest.sort((a, b) => b.value - a.value);
        leaderboard[m].longest = leaderboard[m].longest.slice(0, MAX_LEADERBOARD_ENTRIES);
    }

    // Save to file
    saveLeaderboard(leaderboard);

    // Send back updated leaderboard
    ws.send(JSON.stringify({
        type: 'score_saved',
        mode: m,
        game: 'boggle',
        data: leaderboard[m]
    }));
}

// --- Item System Handlers ---

function handleCheckName(ws, name) {
    const cleanName = (name || '').trim().substring(0, 18);
    if (!cleanName) {
        ws.send(JSON.stringify({ type: 'name_status', error: 'Invalid name' }));
        return;
    }

    // Validate format (no consecutive spaces)
    if (!isValidUsername(cleanName)) {
        ws.send(JSON.stringify({ type: 'name_status', error: 'Name cannot have consecutive spaces' }));
        return;
    }

    // Case-insensitive lookup
    const canonicalName = findPlayerCaseInsensitive(cleanName);
    const exists = !!canonicalName;

    ws.send(JSON.stringify({
        type: 'name_status',
        name: canonicalName || cleanName, // Return canonical name if exists
        exists: exists,
        hasPin: exists
    }));
}

function handleCreatePin(ws, name, pin) {
    const cleanName = (name || '').trim().substring(0, 18);
    const cleanPin = (pin || '').toString();

    if (!cleanName) {
        ws.send(JSON.stringify({ type: 'pin_created', success: false, error: 'Invalid name' }));
        return;
    }

    // Validate format (no consecutive spaces)
    if (!isValidUsername(cleanName)) {
        ws.send(JSON.stringify({ type: 'pin_created', success: false, error: 'Name cannot have consecutive spaces' }));
        return;
    }

    if (cleanPin.length < 1 || cleanPin.length > 18 || !/^\d+$/.test(cleanPin)) {
        ws.send(JSON.stringify({ type: 'pin_created', success: false, error: 'PIN must be 1-18 digits' }));
        return;
    }

    // Case-insensitive check if name already exists
    const existingName = findPlayerCaseInsensitive(cleanName);
    if (existingName) {
        ws.send(JSON.stringify({ type: 'pin_created', success: false, error: 'Name already exists' }));
        return;
    }

    const sessionToken = createPlayer(cleanName, cleanPin);
    console.log(`[ITEMS] Created player: ${cleanName}`);

    ws.send(JSON.stringify({
        type: 'pin_created',
        success: true,
        sessionToken,
        inventory: getEmptyInventory()
    }));
}

function handleVerifyPin(ws, name, pin) {
    const cleanName = (name || '').trim().substring(0, 18);
    const cleanPin = (pin || '').toString();

    if (!cleanName) {
        ws.send(JSON.stringify({ type: 'pin_verified', success: false, error: 'Invalid name' }));
        return;
    }

    // Case-insensitive lookup to find canonical name
    const canonicalName = findPlayerCaseInsensitive(cleanName);
    if (!canonicalName) {
        ws.send(JSON.stringify({ type: 'pin_verified', success: false, error: 'Player not found' }));
        return;
    }

    // Verify PIN against canonical name
    const result = verifyPin(canonicalName, cleanPin);

    if (result.success) {
        console.log(`[ITEMS] PIN verified for: ${canonicalName}`);
        ws.send(JSON.stringify({
            type: 'pin_verified',
            success: true,
            sessionToken: result.sessionToken,
            inventory: result.inventory,
            canonicalName: canonicalName // Return the original casing
        }));
    } else {
        ws.send(JSON.stringify({
            type: 'pin_verified',
            success: false,
            error: result.reason === 'not_found' ? 'Player not found' : 'Wrong PIN'
        }));
    }
}

function handleVerifySession(ws, name, sessionToken) {
    const cleanName = (name || '').trim().substring(0, 18);

    if (!cleanName || !sessionToken) {
        ws.send(JSON.stringify({ type: 'session_status', valid: false }));
        return;
    }

    // Case-insensitive lookup to find canonical name
    const canonicalName = findPlayerCaseInsensitive(cleanName);
    if (!canonicalName) {
        ws.send(JSON.stringify({ type: 'session_status', valid: false }));
        return;
    }

    const result = verifySession(canonicalName, sessionToken);

    ws.send(JSON.stringify({
        type: 'session_status',
        valid: result.valid,
        inventory: result.inventory || null,
        name: canonicalName // Return canonical name
    }));
}

function handleChangeName(ws, oldName, newName, pin, sessionToken) {
    const cleanOldName = (oldName || '').trim().substring(0, 18);
    const cleanNewName = (newName || '').trim().substring(0, 18);
    const cleanPin = (pin || '').toString();

    if (!cleanOldName || !cleanNewName) {
        ws.send(JSON.stringify({ type: 'name_changed', success: false, error: 'Invalid name' }));
        return;
    }

    // Validate new name format (no consecutive spaces)
    if (!isValidUsername(cleanNewName)) {
        ws.send(JSON.stringify({ type: 'name_changed', success: false, error: 'Name cannot have consecutive spaces' }));
        return;
    }

    // Find canonical old name (case-insensitive)
    const canonicalOldName = findPlayerCaseInsensitive(cleanOldName);
    if (!canonicalOldName) {
        ws.send(JSON.stringify({ type: 'name_changed', success: false, error: 'Player not found' }));
        return;
    }

    const oldPlayer = getPlayerData(canonicalOldName);

    // Verify PIN
    if (oldPlayer.pinHash !== hashPin(cleanPin)) {
        ws.send(JSON.stringify({ type: 'name_changed', success: false, error: 'Wrong PIN' }));
        return;
    }

    // Case-insensitive check if new name already exists (and it's not the same account)
    const existingNewName = findPlayerCaseInsensitive(cleanNewName);
    if (existingNewName && existingNewName.toLowerCase() !== canonicalOldName.toLowerCase()) {
        ws.send(JSON.stringify({ type: 'name_changed', success: false, error: 'Name already taken' }));
        return;
    }

    // Move player data to new name
    const newSessionToken = generateSessionToken();
    itemsData.players[cleanNewName] = {
        ...oldPlayer,
        sessions: [newSessionToken],
        lastSeen: new Date().toISOString()
    };

    // Delete old player entry
    delete itemsData.players[canonicalOldName];

    // Update leaderboard entries
    updateLeaderboardName(canonicalOldName, cleanNewName);

    saveItemsData();
    console.log(`[ITEMS] Name changed: ${canonicalOldName} -> ${cleanNewName}`);

    ws.send(JSON.stringify({
        type: 'name_changed',
        success: true,
        sessionToken: newSessionToken,
        newName: cleanNewName
    }));
}

function updateLeaderboardName(oldName, newName) {
    // Update all leaderboard entries with the new name
    const modes = ['singleplayer', 'multiplayer'];
    const categories = ['wins', 'score', 'words', 'longest'];

    for (const mode of modes) {
        if (!leaderboard[mode]) continue;
        
        // First pass: rename all entries
        for (const category of categories) {
            if (!leaderboard[mode][category]) continue;
            for (const entry of leaderboard[mode][category]) {
                if (entry.name === oldName) {
                    entry.name = newName;
                }
            }
        }
        
        // Second pass: deduplicate entries for the same player
        
        // For 'wins' category - merge wins/losses for same player+difficulty+gridSize
        if (leaderboard[mode].wins) {
            const winsMap = new Map();
            for (const entry of leaderboard[mode].wins) {
                const key = `${entry.name}|${entry.difficulty}|${entry.gridSize}`;
                if (winsMap.has(key)) {
                    // Merge: add wins and losses together
                    const existing = winsMap.get(key);
                    existing.wins += entry.wins;
                    existing.losses += entry.losses;
                    // Keep the more recent lastPlayed
                    if (entry.lastPlayed > existing.lastPlayed) {
                        existing.lastPlayed = entry.lastPlayed;
                    }
                } else {
                    winsMap.set(key, { ...entry });
                }
            }
            leaderboard[mode].wins = Array.from(winsMap.values());
            // Re-sort by wins desc
            leaderboard[mode].wins.sort((a, b) => {
                if (b.wins !== a.wins) return b.wins - a.wins;
                const aRate = a.wins / (a.wins + a.losses) || 0;
                const bRate = b.wins / (b.wins + b.losses) || 0;
                return bRate - aRate;
            });
        }
        
        // For 'score', 'words', 'longest' - keep only the BEST entry per player+difficulty+gridSize
        for (const category of ['score', 'words', 'longest']) {
            if (!leaderboard[mode][category]) continue;
            
            const bestMap = new Map();
            for (const entry of leaderboard[mode][category]) {
                const key = `${entry.name}|${entry.difficulty}|${entry.gridSize}`;
                if (bestMap.has(key)) {
                    const existing = bestMap.get(key);
                    if (entry.value > existing.value) {
                        bestMap.set(key, entry);
                    }
                } else {
                    bestMap.set(key, { ...entry });
                }
            }
            leaderboard[mode][category] = Array.from(bestMap.values());
            leaderboard[mode][category].sort((a, b) => b.value - a.value);
            leaderboard[mode][category] = leaderboard[mode][category].slice(0, MAX_LEADERBOARD_ENTRIES);
        }
    }
    saveLeaderboard(leaderboard);
}

// Deduplicate leaderboard entries (cleanup for existing data)
function deduplicateLeaderboard() {
    const modes = ['singleplayer', 'multiplayer'];
    let totalDeduped = 0;
    
    for (const mode of modes) {
        if (!leaderboard[mode]) continue;
        
        // For 'wins' category - merge wins/losses for same player+difficulty+gridSize
        if (leaderboard[mode].wins) {
            const before = leaderboard[mode].wins.length;
            const winsMap = new Map();
            for (const entry of leaderboard[mode].wins) {
                const key = `${entry.name}|${entry.difficulty}|${entry.gridSize}`;
                if (winsMap.has(key)) {
                    const existing = winsMap.get(key);
                    existing.wins += entry.wins;
                    existing.losses += entry.losses;
                    if (entry.lastPlayed > existing.lastPlayed) {
                        existing.lastPlayed = entry.lastPlayed;
                    }
                } else {
                    winsMap.set(key, { ...entry });
                }
            }
            leaderboard[mode].wins = Array.from(winsMap.values());
            leaderboard[mode].wins.sort((a, b) => {
                if (b.wins !== a.wins) return b.wins - a.wins;
                const aRate = a.wins / (a.wins + a.losses) || 0;
                const bRate = b.wins / (b.wins + b.losses) || 0;
                return bRate - aRate;
            });
            totalDeduped += before - leaderboard[mode].wins.length;
        }
        
        // For 'score', 'words', 'longest' - keep only the BEST entry per player+difficulty+gridSize
        for (const category of ['score', 'words', 'longest']) {
            if (!leaderboard[mode][category]) continue;
            
            const before = leaderboard[mode][category].length;
            const bestMap = new Map();
            for (const entry of leaderboard[mode][category]) {
                const key = `${entry.name}|${entry.difficulty}|${entry.gridSize}`;
                if (bestMap.has(key)) {
                    const existing = bestMap.get(key);
                    if (entry.value > existing.value) {
                        bestMap.set(key, entry);
                    }
                } else {
                    bestMap.set(key, { ...entry });
                }
            }
            leaderboard[mode][category] = Array.from(bestMap.values());
            leaderboard[mode][category].sort((a, b) => b.value - a.value);
            leaderboard[mode][category] = leaderboard[mode][category].slice(0, MAX_LEADERBOARD_ENTRIES);
            totalDeduped += before - leaderboard[mode][category].length;
        }
    }
    
    if (totalDeduped > 0) {
        saveLeaderboard(leaderboard);
        console.log(`[LEADERBOARD] Deduplicated: removed ${totalDeduped} duplicate entries`);
    }
}

// Run duplicate merge on startup (now that updateLeaderboardName is defined)
mergeDuplicateAccounts();

// Also deduplicate leaderboard on startup
deduplicateLeaderboard();

function handleGetInventory(ws, name, sessionToken) {
    const cleanName = (name || '').trim().substring(0, 18);

    if (!cleanName || !sessionToken) {
        ws.send(JSON.stringify({ type: 'inventory_data', success: false, error: 'Not authenticated' }));
        return;
    }

    // Case-insensitive lookup
    const canonicalName = findPlayerCaseInsensitive(cleanName);
    if (!canonicalName) {
        ws.send(JSON.stringify({ type: 'inventory_data', success: false, error: 'Player not found' }));
        return;
    }

    const session = verifySession(canonicalName, sessionToken);
    if (!session.valid) {
        ws.send(JSON.stringify({ type: 'inventory_data', success: false, error: 'Invalid session' }));
        return;
    }

    const player = getPlayerData(canonicalName);
    ws.send(JSON.stringify({
        type: 'inventory_data',
        success: true,
        inventory: player.inventory,
        history: player.history || []
    }));
}

function handleRollItems(ws, name, sessionToken, baseRolls, words) {
    const cleanName = (name || '').trim().substring(0, 18);

    // Calculate bonus rolls from words
    let bonusRolls = 0;
    if (words && Array.isArray(words)) {
        for (const word of words) {
            if (word.length === 5) bonusRolls += 1; // 5-letter words: +1 each
            if (word.length >= 7) bonusRolls += 2; // 7+ letter words: +2 each
        }
    }

    const totalRolls = (baseRolls || 1) + bonusRolls;

    // Case-insensitive lookup
    const canonicalName = findPlayerCaseInsensitive(cleanName);
    const player = canonicalName ? getPlayerData(canonicalName) : null;

    if (!player) {
        // New player - need to create PIN first
        // Roll the items but don't save yet - client will prompt for PIN
        const rolls = rollMultipleItems(totalRolls);
        ws.send(JSON.stringify({
            type: 'items_rolled',
            needsPin: true,
            rolls: rolls,
            baseRolls: baseRolls,
            bonusRolls: bonusRolls
        }));
        return;
    }

    // Verify session if provided
    if (sessionToken) {
        const session = verifySession(canonicalName, sessionToken);
        if (!session.valid) {
            ws.send(JSON.stringify({ type: 'items_rolled', success: false, error: 'Invalid session' }));
            return;
        }
    }

    // Roll and add items
    const rolls = rollMultipleItems(totalRolls);
    const result = addItemsToPlayer(canonicalName, rolls);

    if (result) {
        console.log(`[ITEMS] ${canonicalName} rolled ${totalRolls} items (${baseRolls} base + ${bonusRolls} bonus)`);
        ws.send(JSON.stringify({
            type: 'items_rolled',
            success: true,
            rolls: rolls,
            baseRolls: baseRolls,
            bonusRolls: bonusRolls,
            inventory: result.inventory
        }));
    } else {
        ws.send(JSON.stringify({ type: 'items_rolled', success: false, error: 'Failed to add items' }));
    }
}

function handleGetRichest(ws) {
    const richest = getRichestPlayers(20);
    ws.send(JSON.stringify({
        type: 'richest_leaderboard',
        players: richest
    }));
}

// ============================================
// SCRABBLE GAME SYSTEM
// ============================================

// Standard Scrabble tile distribution
const SCRABBLE_TILES = [
    ...Array(9).fill({ letter: 'A', points: 1 }),
    ...Array(2).fill({ letter: 'B', points: 3 }),
    ...Array(2).fill({ letter: 'C', points: 3 }),
    ...Array(4).fill({ letter: 'D', points: 2 }),
    ...Array(12).fill({ letter: 'E', points: 1 }),
    ...Array(2).fill({ letter: 'F', points: 4 }),
    ...Array(3).fill({ letter: 'G', points: 2 }),
    ...Array(2).fill({ letter: 'H', points: 4 }),
    ...Array(9).fill({ letter: 'I', points: 1 }),
    ...Array(1).fill({ letter: 'J', points: 8 }),
    ...Array(1).fill({ letter: 'K', points: 5 }),
    ...Array(4).fill({ letter: 'L', points: 1 }),
    ...Array(2).fill({ letter: 'M', points: 3 }),
    ...Array(6).fill({ letter: 'N', points: 1 }),
    ...Array(8).fill({ letter: 'O', points: 1 }),
    ...Array(2).fill({ letter: 'P', points: 3 }),
    ...Array(1).fill({ letter: 'Q', points: 10 }),
    ...Array(6).fill({ letter: 'R', points: 1 }),
    ...Array(4).fill({ letter: 'S', points: 1 }),
    ...Array(6).fill({ letter: 'T', points: 1 }),
    ...Array(4).fill({ letter: 'U', points: 1 }),
    ...Array(2).fill({ letter: 'V', points: 4 }),
    ...Array(2).fill({ letter: 'W', points: 4 }),
    ...Array(1).fill({ letter: 'X', points: 8 }),
    ...Array(2).fill({ letter: 'Y', points: 4 }),
    ...Array(1).fill({ letter: 'Z', points: 10 }),
    ...Array(2).fill({ letter: '_', points: 0 }) // Blanks
];

// Load/save Scrabble games
function loadScrabbleGames() {
    try {
        if (fs.existsSync(SCRABBLE_GAMES_FILE)) {
            return JSON.parse(fs.readFileSync(SCRABBLE_GAMES_FILE, 'utf8'));
        }
    } catch (e) {
        console.error('[SCRABBLE] Error loading games:', e);
    }
    return { games: {}, playerGames: {} };
}

function saveScrabbleGames() {
    try {
        fs.writeFileSync(SCRABBLE_GAMES_FILE, JSON.stringify(scrabbleData, null, 2));
    } catch (e) {
        console.error('[SCRABBLE] Error saving games:', e);
    }
}

let scrabbleData = loadScrabbleGames();

function shuffleArray(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function createScrabbleGame(player1, player2, isNPC = false) {
    const gameId = `scrabble_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const tileBag = shuffleArray(SCRABBLE_TILES.map(t => ({ ...t })));

    // Draw initial hands (7 tiles each)
    const hand1 = tileBag.splice(0, 7);
    const hand2 = tileBag.splice(0, 7);

    // Empty 15x15 board
    const board = Array(15).fill(null).map(() => Array(15).fill(null));

    const game = {
        id: gameId,
        player1: player1,
        player2: player2,
        isNPC: isNPC,
        currentTurn: player1, // player1 starts
        board: board,
        tileBag: tileBag,
        playerHands: {
            [player1]: hand1,
            [player2]: hand2
        },
        scores: { [player1]: 0, [player2]: 0 },
        moveHistory: [],
        status: 'active',
        isFirstMove: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };

    // Store game
    scrabbleData.games[gameId] = game;

    // Track player games
    if (!scrabbleData.playerGames[player1]) scrabbleData.playerGames[player1] = [];
    if (!scrabbleData.playerGames[player2]) scrabbleData.playerGames[player2] = [];
    scrabbleData.playerGames[player1].push(gameId);
    scrabbleData.playerGames[player2].push(gameId);

    saveScrabbleGames();
    console.log(`[SCRABBLE] Created game ${gameId}: ${player1} vs ${player2}${isNPC ? ' (NPC)' : ''}`);

    return game;
}

function getPlayerScrabbleGames(playerName) {
    const gameIds = scrabbleData.playerGames[playerName] || [];
    return gameIds
        .map(id => scrabbleData.games[id])
        .filter(g => g && g.status === 'active')
        .map(g => ({
            id: g.id,
            player1: g.player1,
            player2: g.player2,
            isNPC: g.isNPC,
            currentTurn: g.currentTurn,
            scores: g.scores,
            updatedAt: g.updatedAt
        }));
}

function getScrabbleGame(gameId, playerName) {
    const game = scrabbleData.games[gameId];
    if (!game) return null;
    if (game.player1 !== playerName && game.player2 !== playerName) return null;

    // Return game state with only THIS player's hand visible
    return {
        id: game.id,
        player1: game.player1,
        player2: game.player2,
        isNPC: game.isNPC,
        currentTurn: game.currentTurn,
        board: game.board,
        myHand: game.playerHands[playerName],
        scores: game.scores,
        tilesRemaining: game.tileBag.length,
        isFirstMove: game.isFirstMove,
        status: game.status,
        moveHistory: game.moveHistory.slice(-5) // Last 5 moves
    };
}

// Scrabble WebSocket handlers
function handleScrabbleGetGames(ws, playerName) {
    const games = getPlayerScrabbleGames(playerName);
    ws.send(JSON.stringify({
        type: 'scrabble_games_list',
        games: games
    }));
}

function handleScrabbleCreateGame(ws, playerName, opponent, isNPC) {
    const game = createScrabbleGame(playerName, opponent || 'NPC Bot', isNPC);
    ws.send(JSON.stringify({
        type: 'scrabble_game_created',
        gameId: game.id
    }));
}

function handleScrabbleLoadGame(ws, gameId, playerName) {
    const game = getScrabbleGame(gameId, playerName);
    if (!game) {
        ws.send(JSON.stringify({ type: 'scrabble_error', error: 'Game not found' }));
        return;
    }
    ws.send(JSON.stringify({
        type: 'scrabble_game_state',
        game: game
    }));
}

function handleScrabblePlayMove(ws, gameId, playerName, placedTiles, score) {
    const game = scrabbleData.games[gameId];
    if (!game || game.status !== 'active') {
        ws.send(JSON.stringify({ type: 'scrabble_error', error: 'Game not found or ended' }));
        return;
    }

    if (game.currentTurn !== playerName) {
        ws.send(JSON.stringify({ type: 'scrabble_error', error: 'Not your turn' }));
        return;
    }

    // Apply tiles to board
    for (const tile of placedTiles) {
        game.board[tile.row][tile.col] = {
            letter: tile.letter,
            points: tile.points,
            assignedLetter: tile.assignedLetter || null
        };
    }

    // Remove placed tiles from player's hand
    const hand = game.playerHands[playerName];
    for (const tile of placedTiles) {
        const idx = hand.findIndex(t => t.letter === tile.letter);
        if (idx !== -1) hand.splice(idx, 1);
    }

    // Draw new tiles
    const drawn = game.tileBag.splice(0, Math.min(placedTiles.length, game.tileBag.length));
    hand.push(...drawn);

    // Update score
    game.scores[playerName] += score;
    game.isFirstMove = false;

    // Add to move history
    game.moveHistory.push({
        player: playerName,
        tiles: placedTiles.length,
        score: score,
        timestamp: new Date().toISOString()
    });

    // Switch turn
    game.currentTurn = game.currentTurn === game.player1 ? game.player2 : game.player1;
    game.updatedAt = new Date().toISOString();

    saveScrabbleGames();
    console.log(`[SCRABBLE] ${playerName} played ${placedTiles.length} tiles for ${score} pts in ${gameId}`);

    // If NPC's turn, make NPC move after short delay
    if (game.isNPC && game.currentTurn === game.player2) {
        setTimeout(() => makeNPCMove(gameId), 1500);
    }

    ws.send(JSON.stringify({
        type: 'scrabble_move_accepted',
        game: getScrabbleGame(gameId, playerName)
    }));
}

function handleScrabblePassTurn(ws, gameId, playerName) {
    const game = scrabbleData.games[gameId];
    if (!game || game.currentTurn !== playerName) {
        ws.send(JSON.stringify({ type: 'scrabble_error', error: 'Cannot pass' }));
        return;
    }

    game.moveHistory.push({
        player: playerName,
        pass: true,
        timestamp: new Date().toISOString()
    });

    game.currentTurn = game.currentTurn === game.player1 ? game.player2 : game.player1;
    game.updatedAt = new Date().toISOString();
    saveScrabbleGames();

    console.log(`[SCRABBLE] ${playerName} passed in ${gameId}`);

    ws.send(JSON.stringify({
        type: 'scrabble_move_accepted',
        game: getScrabbleGame(gameId, playerName)
    }));
}

// Simple NPC logic - just passes for now (can be enhanced later)
function makeNPCMove(gameId) {
    const game = scrabbleData.games[gameId];
    if (!game || game.status !== 'active' || !game.isNPC) return;

    // For now, NPC just passes (simple AI)
    game.moveHistory.push({
        player: game.player2,
        pass: true,
        timestamp: new Date().toISOString()
    });

    game.currentTurn = game.player1;
    game.updatedAt = new Date().toISOString();
    saveScrabbleGames();

    console.log(`[SCRABBLE] NPC passed in ${gameId}`);
}
