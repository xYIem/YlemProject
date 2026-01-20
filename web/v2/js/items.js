/**
 * Ylem Items Module
 * Handles: Item roll calculations, reward requests to server
 * 
 * Requires: config.js, auth.js loaded first
 * 
 * API:
 *   calculateItemRolls(won, difficulty) - Get number of rolls earned
 *   requestItemRolls(baseRolls, words) - Request rolls from server
 *   handleItemsRolled(msg) - Called by auth.js when server responds
 */

// ============================================
// Roll Calculation
// ============================================
function calculateItemRolls(won, difficulty) {
    // Test mode always gives 1 roll
    if (difficulty === 'test') return 1;
    
    // Must win to get rolls
    if (!won) return 0;
    
    switch (difficulty) {
        case 'easy': return 1;
        case 'medium': return 3;
        case 'hard': return 5;
        default: return 1;
    }
}

// ============================================
// Request Rolls from Server
// ============================================
function requestItemRolls(baseRolls, words) {
    if (!isAuthenticated()) return;
    
    // Don't request if no rolls earned
    if (baseRolls === 0) return;
    
    sendAuthMessage({
        type: 'roll_items',
        name: getPlayerName(),
        sessionToken: getSessionToken(),
        rolls: baseRolls,
        words: words || []
    });
}

// ============================================
// Handle Server Response
// ============================================
function handleItemsRolled(msg) {
    if (msg.success && msg.rolls) {
        // Show the item earned animation
        showItemEarned(msg.rolls, msg.inventory);
    }
}

// ============================================
// Bonus Roll Calculation (for word-based bonuses)
// ============================================
function calculateBonusRolls(words) {
    let bonus = 0;
    
    if (!words || words.length === 0) return bonus;
    
    // Bonus for long words
    words.forEach(function(word) {
        if (word.length >= 8) bonus += 1;
        if (word.length >= 10) bonus += 1;
    });
    
    // Bonus for finding many words
    if (words.length >= 20) bonus += 1;
    if (words.length >= 30) bonus += 2;
    if (words.length >= 40) bonus += 3;
    
    return bonus;
}
