/**
 * Ylem Leaderboard Module v2
 * Features: Game tabs, Wins/Losses tracking, difficulty/grid filters
 * 
 * Requires: auth.js loaded first (uses sendAuthMessage)
 * 
 * API:
 *   initLeaderboard() - Call on page load
 *   showLeaderboard() - Open leaderboard overlay
 *   hideLeaderboard() - Close leaderboard overlay
 *   handleLeaderboardMessage(msg) - Called by auth.js when server responds
 *   saveScore(scoreData) - Submit a score to leaderboard
 */

// ============================================
// State
// ============================================
let leaderboardData = {
    boggle: {
        wins: [],      // { name, wins, losses, winRate, difficulty, gridSize }
        score: [],     // { name, value, gridSize, difficulty }
        words: [],     // { name, value, gridSize, difficulty }
        longest: []    // { name, value, word, gridSize, difficulty }
    }
};

let currentGame = 'boggle';
let currentCategory = 'wins';
let currentGridFilter = 'all';   // 'all', '4', '5'
let currentDiffFilter = 'all';   // 'all', 'easy', 'medium', 'hard'

// ============================================
// Initialize
// ============================================
function initLeaderboard() {
    injectLeaderboardHTML();
}

// ============================================
// Show/Hide
// ============================================
function showLeaderboard() {
    if (typeof sendAuthMessage === 'function') {
        sendAuthMessage({ type: 'get_leaderboard', mode: 'singleplayer', game: currentGame });
    }
    updateLeaderboardUI();
    document.getElementById('leaderboardOverlay').classList.remove('hidden');
}

function hideLeaderboard() {
    document.getElementById('leaderboardOverlay').classList.add('hidden');
}

// ============================================
// Game Tab Switching
// ============================================
function switchLeaderboardGame(game) {
    currentGame = game;
    currentCategory = 'wins'; // Reset to wins when switching games
    
    document.querySelectorAll('.leaderboard-game-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.game === game);
    });
    
    // Request fresh data for this game
    if (typeof sendAuthMessage === 'function') {
        sendAuthMessage({ type: 'get_leaderboard', mode: 'singleplayer', game: game });
    }
    
    updateLeaderboardUI();
}

// ============================================
// Category Tab Switching
// ============================================
function switchLeaderboardCategory(category) {
    currentCategory = category;
    
    document.querySelectorAll('.leaderboard-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.tab === category);
    });
    
    renderLeaderboard();
}

// ============================================
// Filter Switching
// ============================================
function switchGridFilter(filter) {
    currentGridFilter = filter;
    
    document.querySelectorAll('.leaderboard-filter-grid').forEach(f => {
        f.classList.toggle('active', f.dataset.filter === filter);
    });
    
    renderLeaderboard();
}

function switchDiffFilter(filter) {
    currentDiffFilter = filter;
    
    document.querySelectorAll('.leaderboard-filter-diff').forEach(f => {
        f.classList.toggle('active', f.dataset.filter === filter);
    });
    
    renderLeaderboard();
}

// ============================================
// Update UI (tabs based on current game)
// ============================================
function updateLeaderboardUI() {
    const categoryTabs = document.getElementById('leaderboardCategoryTabs');
    
    if (currentGame === 'boggle') {
        categoryTabs.innerHTML = `
            <button class="leaderboard-tab ${currentCategory === 'wins' ? 'active' : ''}" data-tab="wins" onclick="switchLeaderboardCategory('wins')">Wins</button>
            <button class="leaderboard-tab ${currentCategory === 'score' ? 'active' : ''}" data-tab="score" onclick="switchLeaderboardCategory('score')">Top Score</button>
            <button class="leaderboard-tab ${currentCategory === 'words' ? 'active' : ''}" data-tab="words" onclick="switchLeaderboardCategory('words')">Most Words</button>
            <button class="leaderboard-tab ${currentCategory === 'longest' ? 'active' : ''}" data-tab="longest" onclick="switchLeaderboardCategory('longest')">Longest</button>
        `;
    }
    
    renderLeaderboard();
}

// ============================================
// Render
// ============================================
function renderLeaderboard() {
    const gameData = leaderboardData[currentGame] || {};
    let entries = gameData[currentCategory] || [];
    
    // Apply grid size filter
    if (currentGridFilter !== 'all') {
        const gridSize = parseInt(currentGridFilter);
        entries = entries.filter(entry => entry.gridSize === gridSize);
    }
    
    // Apply difficulty filter
    if (currentDiffFilter !== 'all') {
        entries = entries.filter(entry => entry.difficulty === currentDiffFilter);
    }
    
    const list = document.getElementById('leaderboardList');
    if (!list) return;
    
    if (entries.length === 0) {
        list.innerHTML = '<div class="leaderboard-empty">No scores yet. Be the first!</div>';
        return;
    }

    list.innerHTML = entries.map((entry, i) => {
        const rankClass = i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : '';
        const gridLabel = entry.gridSize === 5 ? '5×5' : '4×4';
        const diffLabel = entry.difficulty ? entry.difficulty.charAt(0).toUpperCase() + entry.difficulty.slice(1) : '';
        
        let valueDisplay, subtext;
        
        if (currentCategory === 'wins') {
            const winRate = entry.losses > 0 ? Math.round((entry.wins / (entry.wins + entry.losses)) * 100) : (entry.wins > 0 ? 100 : 0);
            valueDisplay = `${entry.wins}W / ${entry.losses}L`;
            subtext = `${winRate}% • ${diffLabel} ${gridLabel}`;
        } else if (currentCategory === 'score') {
            valueDisplay = entry.value + ' pts';
            subtext = `${diffLabel} ${gridLabel}`;
        } else if (currentCategory === 'words') {
            valueDisplay = entry.value + ' words';
            subtext = `${diffLabel} ${gridLabel}`;
        } else if (currentCategory === 'longest') {
            valueDisplay = entry.word || entry.value + ' chars';
            subtext = `${entry.value} letters • ${diffLabel} ${gridLabel}`;
        }
        
        return `
            <div class="leaderboard-entry ${rankClass}">
                <div class="leaderboard-rank">#${i + 1}</div>
                <div class="leaderboard-name">${escapeHtml(entry.name)} <span class="leaderboard-subtext">${subtext}</span></div>
                <div class="leaderboard-value">${valueDisplay}</div>
            </div>
        `;
    }).join('');
}

// ============================================
// Handle Server Messages (called by auth.js)
// ============================================
function handleLeaderboardMessage(msg) {
    if (msg.type === 'leaderboard_data' || msg.type === 'score_saved') {
        const game = msg.game || 'boggle';
        if (msg.data) {
            leaderboardData[game] = msg.data;
            renderLeaderboard();
        }
    }
}

// ============================================
// Save Score (includes win/loss)
// ============================================
function saveScore(scoreData) {
    // scoreData: { name, score, wordCount, longestWord, gridSize, difficulty, won }
    const msg = {
        type: 'submit_score',
        mode: 'singleplayer',
        game: 'boggle',
        name: scoreData.name,
        score: scoreData.score,
        wordCount: scoreData.wordCount,
        longestWord: scoreData.longestWord,
        gridSize: scoreData.gridSize,
        difficulty: scoreData.difficulty,
        won: scoreData.won !== undefined ? scoreData.won : true
    };
    
    if (typeof sendAuthMessage === 'function') {
        sendAuthMessage(msg);
    }
}

// ============================================
// Utility
// ============================================
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ============================================
// HTML Injection
// ============================================
function injectLeaderboardHTML() {
    const html = `
        <div class="leaderboard-overlay hidden" id="leaderboardOverlay">
            <div class="leaderboard-content">
                <div class="leaderboard-title">🏆 Leaderboards</div>
                
                <!-- Game Tabs -->
                <div class="leaderboard-game-tabs">
                    <button class="leaderboard-game-tab active" data-game="boggle" onclick="switchLeaderboardGame('boggle')">Boggle</button>
                </div>
                
                <!-- Category Tabs -->
                <div class="leaderboard-tabs" id="leaderboardCategoryTabs">
                    <button class="leaderboard-tab active" data-tab="wins" onclick="switchLeaderboardCategory('wins')">Wins</button>
                    <button class="leaderboard-tab" data-tab="score" onclick="switchLeaderboardCategory('score')">Top Score</button>
                    <button class="leaderboard-tab" data-tab="words" onclick="switchLeaderboardCategory('words')">Most Words</button>
                    <button class="leaderboard-tab" data-tab="longest" onclick="switchLeaderboardCategory('longest')">Longest</button>
                </div>
                
                <!-- Grid Size Filters -->
                <div class="leaderboard-filter-row">
                    <span class="leaderboard-filter-label">Grid:</span>
                    <div class="leaderboard-filters">
                        <button class="leaderboard-filter-grid active" data-filter="all" onclick="switchGridFilter('all')">All</button>
                        <button class="leaderboard-filter-grid" data-filter="4" onclick="switchGridFilter('4')">4×4</button>
                        <button class="leaderboard-filter-grid" data-filter="5" onclick="switchGridFilter('5')">5×5</button>
                    </div>
                </div>
                
                <!-- Difficulty Filters -->
                <div class="leaderboard-filter-row">
                    <span class="leaderboard-filter-label">Diff:</span>
                    <div class="leaderboard-filters">
                        <button class="leaderboard-filter-diff active" data-filter="all" onclick="switchDiffFilter('all')">All</button>
                        <button class="leaderboard-filter-diff" data-filter="easy" onclick="switchDiffFilter('easy')">Easy</button>
                        <button class="leaderboard-filter-diff" data-filter="medium" onclick="switchDiffFilter('medium')">Med</button>
                        <button class="leaderboard-filter-diff" data-filter="hard" onclick="switchDiffFilter('hard')">Hard</button>
                    </div>
                </div>
                
                <!-- Leaderboard List -->
                <div class="leaderboard-list" id="leaderboardList">
                    <div class="leaderboard-empty">No scores yet. Be the first!</div>
                </div>
                
                <button class="menu-btn" onclick="hideLeaderboard()">Close</button>
            </div>
        </div>
    `;
    
    const container = document.createElement('div');
    container.id = 'leaderboard-container';
    container.innerHTML = html;
    document.body.appendChild(container);
}
