/**
 * Ylem Config - Shared item definitions
 * Used by: auth.js, inventory.js, items.js, all games
 */

// ============================================
// Item Definitions
// ============================================
const ITEM_CONFIG = {
    silver_coin: { 
        icon: '🔘', 
        name: 'Silver Coin', 
        rarity: 'common',
        type: 'Ancient Currency',
        lore: 'Minted in forgotten kingdoms long turned to dust, these tarnished coins still bear the noble faces of rulers whose names have faded from memory.'
    },
    gold_coin: { 
        icon: '🪙', 
        name: 'Gold Coin', 
        rarity: 'common',
        type: 'Royal Treasury',
        lore: 'Gleaming with an eternal luster that time cannot diminish, these coins were once held by merchant princes and warrior queens.'
    },
    opal: { 
        icon: '⚪', 
        name: 'Opal', 
        rarity: 'uncommon',
        type: 'Moonstone Gem',
        lore: 'Within its luminous depths swirl ethereal clouds of pearl and silver, like captured moonlight given form.'
    },
    amethyst: { 
        icon: '🟣', 
        name: 'Amethyst', 
        rarity: 'uncommon',
        type: 'Twilight Crystal',
        lore: 'Born in the sacred caverns where starlight meets stone, these violet crystals pulse with ancient arcane energy.'
    },
    moonstone: { 
        icon: '🌙', 
        name: 'Moonstone', 
        rarity: 'rare',
        type: 'Lunar Fragment',
        lore: 'Harvested only when three moons align, these pale stones emit a soft, otherworldly glow.'
    },
    ruby: { 
        icon: '🔴', 
        name: 'Ruby', 
        rarity: 'rare',
        type: 'Heartfire Stone',
        lore: 'Radiant as captured flame, the ruby burns with an inner fire that never fades.'
    },
    sapphire: { 
        icon: '🔵', 
        name: 'Sapphire', 
        rarity: 'epic',
        type: 'Celestial Tear',
        lore: 'Fallen from the crowns of celestial beings, sapphires carry the infinite blue of endless skies.'
    },
    diamond: { 
        icon: '💎', 
        name: 'Diamond', 
        rarity: 'legendary',
        type: 'Eternal Prism',
        lore: 'The diamond transcends mere beauty—it is perfection crystallized across millennia of immense pressure and time.'
    },
    faded_page: { 
        icon: '📜', 
        name: 'Faded Page', 
        rarity: 'legendary',
        type: 'Forbidden Knowledge',
        lore: 'A fragment torn from a tome that should not exist. The ink shifts and writhes when unobserved.'
    },
    cursed_amulet: { 
        icon: '🧿', 
        name: 'Cursed Amulet', 
        rarity: 'mythic',
        type: 'Corrupted Relic',
        lore: 'Beautiful and terrible in equal measure, this twisted jewelry radiates an aura of ancient malevolence.'
    }
};

const ITEM_ORDER = ['silver_coin', 'gold_coin', 'opal', 'amethyst', 'moonstone', 'ruby', 'sapphire', 'diamond', 'faded_page', 'cursed_amulet'];
const RARE_ITEMS = ['moonstone', 'ruby', 'sapphire', 'diamond', 'faded_page', 'cursed_amulet'];

// ============================================
// Helpers
// ============================================
function getEmptyInventory() {
    const inv = {};
    ITEM_ORDER.forEach(item => inv[item] = 0);
    return inv;
}
