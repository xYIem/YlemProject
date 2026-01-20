/**
 * Shared utilities for Ylem Game Server
 * Auth, Items, Leaderboard, and Name Generation
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// File paths
const LEADERBOARD_FILE = path.join(__dirname, '..', 'leaderboard.json');
const ITEMS_FILE = path.join(__dirname, '..', 'items.json');
const MAX_LEADERBOARD_ENTRIES = 20;
const SESSION_DURATION_DAYS = 90;

// ============================================
// ITEM CONFIGURATION
// ============================================
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

// ============================================
// LEADERBOARD
// ============================================
function loadLeaderboard() {
    try {
        if (fs.existsSync(LEADERBOARD_FILE)) {
            const data = fs.readFileSync(LEADERBOARD_FILE, 'utf8');
            const lb = JSON.parse(data);
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

// ============================================
// ITEMS DATA
// ============================================
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
// AUTH HELPERS
// ============================================
function generateSessionToken() {
    return crypto.randomBytes(32).toString('hex');
}

function hashPin(pin) {
    return crypto.createHash('sha256').update(pin).digest('hex');
}

// ============================================
// ITEM ROLLING
// ============================================
function rollItem() {
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
    
    if (!selectedCategory) selectedCategory = ITEM_CATEGORIES.coins;
    
    const itemRand = Math.random();
    let itemCumulative = 0;
    
    for (const [itemName, itemData] of Object.entries(selectedCategory.items)) {
        itemCumulative += itemData.chance;
        if (itemRand < itemCumulative) {
            return itemName;
        }
    }
    
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
        silver_coin: 0, gold_coin: 0, opal: 0, amethyst: 0, moonstone: 0,
        ruby: 0, sapphire: 0, diamond: 0, faded_page: 0, cursed_amulet: 0
    };
}

// ============================================
// PLAYER DATA
// ============================================
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
    
    const sessionToken = generateSessionToken();
    player.sessions.push(sessionToken);
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
    
    player.history.unshift({
        items: items,
        timestamp: new Date().toISOString()
    });
    if (player.history.length > 20) {
        player.history = player.history.slice(0, 20);
    }
    
    saveItemsData();
    return { inventory: player.inventory };
}

function getRichestPlayers(limit = 20) {
    const players = Object.entries(itemsData.players)
        .map(([name, data]) => {
            const totalItems = Object.values(data.inventory).reduce((a, b) => a + b, 0);
            return { name, totalItems, inventory: data.inventory };
        })
        .sort((a, b) => b.totalItems - a.totalItems)
        .slice(0, limit);
    return players;
}

// ============================================
// NAME GENERATOR
// ============================================
const NAME_PARTS = {
    prefixes: [
        'Pickle', 'Chunky', 'Soggy', 'Crispy', 'Spicy', 'Greasy', 'Moldy', 'Crusty', 
        'Crunchy', 'Salty', 'Moist', 'Stale', 'Burnt', 'Raw', 'Frozen', 'Lukewarm',
        'Funky', 'Sneaky', 'Sweaty', 'Sketchy', 'Shady', 'Sussy', 'Based', 'Cringe',
        'Grumpy', 'Hangry', 'Sleepy', 'Dizzy', 'Cranky', 'Moody', 'Edgy', 'Cursed',
        'Chonky', 'Thicc', 'Smol', 'Absolute', 'Mega', 'Ultra', 'Giga', 'Tiny', 'Massive',
        'Captain', 'Doctor', 'Professor', 'Lord', 'Sir', 'King', 'Queen', 'Duke', 'Baron',
        'His Highness', 'Her Majesty', 'Grand', 'Supreme', 'Legendary', 'Epic', 'Mythic',
        'Big', 'Lil', 'MC', 'DJ', 'El', 'Le', 'Da', 'Xx', 'CEO of',
        'Feral', 'Chaotic', 'Unhinged', 'Froggy', 'Spooky', 'Goofy', 'Wacky', 'Derpy',
        'Sigma', 'Alpha', 'Beta', 'Omega', 'Gigachad', 'Chad', 'Virgin', 'Boomer',
        'Zoomer', 'NPC', 'Main Character', 'Side Quest', 'Final Boss', 'Tutorial',
        'Certified', 'Professional', 'Amateur', 'Retired', 'Wannabe', 'Bootleg',
        'Discount', 'Walmart', 'Gucci', 'Broke', 'Rich', 'Fancy', 'Bougie'
    ],
    middles: [
        'Waffle', 'Nugget', 'Pickle', 'Taco', 'Bean', 'Noodle', 'Potato', 'Biscuit',
        'Donut', 'Burrito', 'Hotdog', 'Muffin', 'Pancake', 'Turnip', 'Cabbage', 'Banana',
        'Cheese', 'Bacon', 'Shrimp', 'Lobster', 'Tendies', 'Nuggies', 'Borger', 'Pizza',
        'Spaghetti', 'Ramen', 'Toast', 'Croissant', 'Bagel', 'Pretzel', 'Nacho', 'Salsa',
        'Goblin', 'Gremlin', 'Hamster', 'Raccoon', 'Possum', 'Goose', 'Moose', 'Chicken',
        'Hawk', 'Cat', 'Doggo', 'Frog', 'Toad', 'Moth', 'Crab', 'Monke', 'Doge', 'Cheems',
        'Shibe', 'Pupper', 'Birb', 'Snek', 'Danger Noodle', 'Murder Hornet', 'Trash Panda',
        'Capybara', 'Quokka', 'Axolotl', 'Blobfish', 'Platypus', 'Llama', 'Alpaca',
        'Cowboy', 'Wizard', 'Ninja', 'Pirate', 'Viking', 'Zombie', 'Vampire', 'Werewolf',
        'Ghost', 'Skeleton', 'Clown', 'Jester', 'Karen', 'Kevin', 'Chad', 'Stacy',
        'Boomer', 'Zoomer', 'Doomer', 'Coomer', 'Gamer', 'Streamer', 'Influencer',
        'Sock', 'Pants', 'Croc', 'Sandal', 'Toilet', 'Dumpster', 'Microwave', 'Toaster',
        'Roomba', 'Printer', 'Nokia', 'Fridge', 'Lamp', 'Chair', 'Table', 'Spoon',
        'Yeet', 'Bonk', 'Chungus', 'Dingus', 'Bongo', 'Stonks', 'Meme', 'Vine', 'Ratio',
        'Rizz', 'Skibidi', 'Gyatt', 'Ohio', 'Amogus', 'Sus', 'Bruh', 'Oof', 'Poggers',
        'Chaos', 'Danger', 'Thunder', 'Laser', 'Turbo', 'Crypto', 'Blockchain', 'NFT',
        'Beef', 'Pork', 'Drama', 'Clout', 'Vibe', 'Mood', 'Energy', 'Aura'
    ],
    suffixes: [
        'Master', 'Lord', 'King', 'Queen', 'Prince', 'Princess', 'Emperor', 'Empress',
        'Boy', 'Girl', 'Man', 'Woman', 'Dude', 'Bro', 'Guy', 'Lad', 'Lass',
        'Slayer', 'Destroyer', 'Hunter', 'Lover', 'Whisperer', 'Wrangler', 'Tamer',
        'Yeeter', 'Bonker', 'Enjoyer', 'Appreciator', 'Connoisseur', 'Enthusiast',
        'Hater', 'Stan', 'Simp', 'Respecter', 'Ignorer', 'Denier', 'Believer',
        'Monster', 'Gamer', 'Legend', 'Champion', 'Warrior', 'Knight', 'Bandit',
        'Demon', 'Angel', 'God', 'Goddess', 'Saint', 'Sinner', 'Hero', 'Villain',
        'Main Character', 'NPC', 'Boss', 'Minion', 'Intern', 'Manager', 'CEO',
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
        () => {
            const pre = NAME_PARTS.prefixes[Math.floor(Math.random() * NAME_PARTS.prefixes.length)];
            const mid = NAME_PARTS.middles[Math.floor(Math.random() * NAME_PARTS.middles.length)];
            const num = NAME_PARTS.funnyNumbers[Math.floor(Math.random() * NAME_PARTS.funnyNumbers.length)];
            return `${pre}${mid}${num}`;
        },
        () => {
            const mid = NAME_PARTS.middles[Math.floor(Math.random() * NAME_PARTS.middles.length)];
            const suf = NAME_PARTS.suffixes[Math.floor(Math.random() * NAME_PARTS.suffixes.length)];
            return `${mid}${suf}`;
        },
        () => {
            const pre = NAME_PARTS.prefixes[Math.floor(Math.random() * NAME_PARTS.prefixes.length)];
            const mid = NAME_PARTS.middles[Math.floor(Math.random() * NAME_PARTS.middles.length)];
            const suf = NAME_PARTS.suffixes[Math.floor(Math.random() * NAME_PARTS.suffixes.length)];
            return `${pre}${mid}${suf}`;
        },
        () => {
            const mid = NAME_PARTS.middles[Math.floor(Math.random() * NAME_PARTS.middles.length)];
            const num = NAME_PARTS.funnyNumbers[Math.floor(Math.random() * NAME_PARTS.funnyNumbers.length)];
            return `xX${mid}${num}Xx`;
        },
        () => {
            const mid1 = NAME_PARTS.middles[Math.floor(Math.random() * NAME_PARTS.middles.length)];
            const mid2 = NAME_PARTS.middles[Math.floor(Math.random() * NAME_PARTS.middles.length)];
            const num = NAME_PARTS.funnyNumbers[Math.floor(Math.random() * NAME_PARTS.funnyNumbers.length)];
            return `${mid1}_${mid2}${num}`;
        },
        () => {
            const mid = NAME_PARTS.middles[Math.floor(Math.random() * NAME_PARTS.middles.length)];
            const pre = ['TheReal', 'NotA', 'Definitely', 'Literally', 'Actually', 'Secret', 'Fake', 'Certified', 'Licensed'][Math.floor(Math.random() * 9)];
            return `${pre}${mid}`;
        },
        () => {
            const mid = NAME_PARTS.middles[Math.floor(Math.random() * NAME_PARTS.middles.length)];
            const suf = ['Enjoyer', 'Appreciator', 'Hater', 'Stan', 'Simp', 'Denier', 'Believer', 'Respecter'][Math.floor(Math.random() * 8)];
            return `${mid}${suf}`;
        },
        () => {
            const mid = NAME_PARTS.middles[Math.floor(Math.random() * NAME_PARTS.middles.length)];
            const title = ['CEO of', 'President of', 'Duke of', 'Lord of', 'King of', 'God of'][Math.floor(Math.random() * 6)];
            return `${title} ${mid}`;
        }
    ];
    
    const pattern = patterns[Math.floor(Math.random() * patterns.length)];
    return pattern().substring(0, 20);
}

// ============================================
// EXPORTS
// ============================================
module.exports = {
    // Constants
    ITEM_CATEGORIES,
    ITEM_ORDER,
    MAX_LEADERBOARD_ENTRIES,
    
    // Leaderboard
    leaderboard,
    loadLeaderboard,
    saveLeaderboard,
    
    // Items
    itemsData,
    loadItemsData,
    saveItemsData,
    rollItem,
    rollMultipleItems,
    getEmptyInventory,
    
    // Players
    getPlayerData,
    createPlayer,
    verifyPin,
    verifySession,
    addItemsToPlayer,
    getRichestPlayers,
    
    // Auth
    generateSessionToken,
    hashPin,
    
    // Name Generator
    generateName
};
