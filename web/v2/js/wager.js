/**
 * Wager Module
 * Wager selection UI, ready check, real-time sync
 * Depends on: config.js, inventory.js
 */

// ============================================
// Wager State
// ============================================
const wagerState = {
    myWager: null,
    oppWager: null,
    myConfirmed: false,
    oppConfirmed: false,
    myReady: false,
    oppReady: false,
    opponentName: ''
};

// Initialize wager state
function initWagerState() {
    wagerState.myWager = getEmptyWager();
    wagerState.oppWager = getEmptyWager();
    wagerState.myConfirmed = false;
    wagerState.oppConfirmed = false;
    wagerState.myReady = false;
    wagerState.oppReady = false;
}

// ============================================
// Initialize Wager UI
// ============================================
function initWagerUI() {
    var container = document.createElement('div');
    container.id = 'wager-container';
    container.innerHTML = generateWagerHTML();
    document.body.appendChild(container);
}

// ============================================
// Generate Wager HTML
// ============================================
function generateWagerHTML() {
    return '\
        <!-- Wager Selection Overlay -->\
        <div class="wager-overlay hidden" id="wagerSelectOverlay">\
            <div class="wager-content">\
                <div class="wager-title">⚔️ Select Your Wager</div>\
                <div class="wager-main">\
                    <div class="wager-section">\
                        <div class="wager-section-title">Your Inventory</div>\
                        <div class="wager-grid" id="wagerInventoryGrid"></div>\
                    </div>\
                    <div class="wager-section">\
                        <div class="wager-section-title">Your Wager</div>\
                        <div class="wager-grid" id="wagerMyGrid"></div>\
                    </div>\
                    <div class="wager-section opponent">\
                        <div class="wager-section-title">Opponent\'s Wager</div>\
                        <div class="wager-grid" id="wagerOppGrid"></div>\
                        <div class="wager-status" id="wagerOppStatus">Selecting...</div>\
                    </div>\
                </div>\
                <div class="wager-status" id="wagerHint">Click items in your inventory to add to wager</div>\
                <div class="wager-buttons">\
                    <button class="wager-btn confirm" id="wagerConfirmBtn" onclick="confirmWager()">Confirm Wager</button>\
                    <button class="wager-btn leave" onclick="leaveWager()">Leave</button>\
                </div>\
            </div>\
        </div>\
        \
        <!-- Wager Ready Overlay -->\
        <div class="wager-overlay hidden" id="wagerReadyOverlay">\
            <div class="wager-content ready-content">\
                <div class="wager-title">🔒 Wagers Locked!</div>\
                <div class="ready-vs">\
                    <div class="ready-wager">\
                        <div class="ready-wager-label">Your Wager</div>\
                        <div class="ready-wager-items" id="readyMyWager"></div>\
                    </div>\
                    <div class="ready-vs-text">VS</div>\
                    <div class="ready-wager opponent">\
                        <div class="ready-wager-label">Opponent\'s Wager</div>\
                        <div class="ready-wager-items" id="readyOppWager"></div>\
                    </div>\
                </div>\
                <div class="ready-pot">\
                    <div class="ready-pot-label">🏆 Total Pot</div>\
                    <div class="ready-pot-items" id="readyPot"></div>\
                </div>\
                <div class="ready-status" id="readyStatus">\
                    <span class="waiting">Waiting for opponent...</span>\
                </div>\
                <div class="wager-buttons">\
                    <button class="wager-btn ready" id="readyBtn" onclick="confirmReady()">Ready!</button>\
                    <button class="wager-btn leave" onclick="cancelReady()">Cancel</button>\
                </div>\
            </div>\
        </div>\
    ';
}

// ============================================
// Reset Wager State
// ============================================
function resetWagerState() {
    ITEM_ORDER.forEach(function(item) {
        wagerState.myWager[item] = 0;
        wagerState.oppWager[item] = 0;
    });
    wagerState.myConfirmed = false;
    wagerState.oppConfirmed = false;
    wagerState.myReady = false;
    wagerState.oppReady = false;
}

// ============================================
// Show Wager Selection
// ============================================
function showWagerSelect(opponentName) {
    resetWagerState();
    wagerState.opponentName = opponentName;
    
    renderWagerInventory();
    renderMyWager();
    renderOppWager();
    
    document.getElementById('wagerOppStatus').textContent = 'Selecting...';
    document.getElementById('wagerOppStatus').classList.remove('confirmed');
    document.getElementById('wagerConfirmBtn').disabled = false;
    document.getElementById('wagerHint').textContent = 'Playing against ' + opponentName + '. Click items to wager.';
    document.getElementById('wagerSelectOverlay').classList.remove('hidden');
}

function hideWagerSelect() {
    document.getElementById('wagerSelectOverlay').classList.add('hidden');
}

// ============================================
// Render Wager Grids
// ============================================
function renderWagerInventory() {
    var grid = document.getElementById('wagerInventoryGrid');
    if (!grid) return;
    grid.innerHTML = '';
    
    ITEM_ORDER.forEach(function(itemKey) {
        var available = (inventoryState.inventory[itemKey] || 0) - wagerState.myWager[itemKey];
        var item = ITEM_CONFIG[itemKey];
        var slot = document.createElement('div');
        slot.className = 'wager-slot ' + (available > 0 ? 'has-item' : 'empty') + ' rarity-' + item.rarity;
        slot.innerHTML = '\
            <span class="wager-slot-icon">' + item.icon + '</span>\
            <span class="wager-slot-count">x' + available + '</span>\
        ';
        if (available > 0 && !wagerState.myConfirmed) {
            slot.onclick = function() { addToWager(itemKey); };
        }
        grid.appendChild(slot);
    });
}

function renderMyWager() {
    var grid = document.getElementById('wagerMyGrid');
    if (!grid) return;
    grid.innerHTML = '';
    
    ITEM_ORDER.forEach(function(itemKey) {
        var count = wagerState.myWager[itemKey];
        var item = ITEM_CONFIG[itemKey];
        var slot = document.createElement('div');
        slot.className = 'wager-slot ' + (count > 0 ? 'has-item' : '') + ' rarity-' + item.rarity;
        if (count > 0) {
            slot.innerHTML = '\
                <span class="wager-slot-icon">' + item.icon + '</span>\
                <span class="wager-slot-count">x' + count + '</span>\
            ';
            if (!wagerState.myConfirmed) {
                slot.onclick = function() { removeFromWager(itemKey); };
            }
        }
        grid.appendChild(slot);
    });
}

function renderOppWager() {
    var grid = document.getElementById('wagerOppGrid');
    if (!grid) return;
    grid.innerHTML = '';
    
    ITEM_ORDER.forEach(function(itemKey) {
        var count = wagerState.oppWager[itemKey];
        var item = ITEM_CONFIG[itemKey];
        var slot = document.createElement('div');
        slot.className = 'wager-slot ' + (count > 0 ? 'has-item' : '') + ' rarity-' + item.rarity + ' disabled';
        if (count > 0) {
            slot.innerHTML = '\
                <span class="wager-slot-icon">' + item.icon + '</span>\
                <span class="wager-slot-count">x' + count + '</span>\
            ';
        }
        grid.appendChild(slot);
    });
}

// ============================================
// Add/Remove from Wager
// ============================================
function addToWager(itemKey) {
    if (wagerState.myConfirmed) return;
    var available = (inventoryState.inventory[itemKey] || 0) - wagerState.myWager[itemKey];
    if (available > 0) {
        wagerState.myWager[itemKey]++;
        renderWagerInventory();
        renderMyWager();
        
        // Notify server
        if (typeof sendWagerUpdate === 'function') {
            sendWagerUpdate(wagerState.myWager);
        }
    }
}

function removeFromWager(itemKey) {
    if (wagerState.myConfirmed) return;
    if (wagerState.myWager[itemKey] > 0) {
        wagerState.myWager[itemKey]--;
        renderWagerInventory();
        renderMyWager();
        
        // Notify server
        if (typeof sendWagerUpdate === 'function') {
            sendWagerUpdate(wagerState.myWager);
        }
    }
}

// ============================================
// Update Opponent Wager (from server)
// ============================================
function updateOpponentWager(wager) {
    wagerState.oppWager = wager;
    renderOppWager();
}

// ============================================
// Confirm Wager
// ============================================
function confirmWager() {
    wagerState.myConfirmed = true;
    document.getElementById('wagerConfirmBtn').disabled = true;
    document.getElementById('wagerHint').textContent = 'Wager confirmed! Waiting for opponent...';
    
    // Notify server
    if (typeof sendWagerConfirm === 'function') {
        sendWagerConfirm(wagerState.myWager);
    }
}

// ============================================
// Leave Wager
// ============================================
function leaveWager() {
    hideWagerSelect();
    resetWagerState();
    
    // Notify server
    if (typeof sendWagerLeave === 'function') {
        sendWagerLeave();
    }
    
    // Callback for game
    if (typeof onWagerLeft === 'function') {
        onWagerLeft();
    }
}

// ============================================
// Show Ready Screen
// ============================================
function showWagerReady(myWager, oppWager) {
    hideWagerSelect();
    wagerState.myReady = false;
    wagerState.oppReady = false;
    
    // Render my wager
    var myDiv = document.getElementById('readyMyWager');
    myDiv.innerHTML = '';
    var myHasItems = false;
    ITEM_ORDER.forEach(function(itemKey) {
        var count = myWager[itemKey];
        if (count > 0) {
            myDiv.innerHTML += '<span class="ready-item">' + ITEM_CONFIG[itemKey].icon + 'x' + count + '</span>';
            myHasItems = true;
        }
    });
    if (!myHasItems) myDiv.innerHTML = '<span style="color:var(--text-muted)">Nothing</span>';
    
    // Render opponent wager
    var oppDiv = document.getElementById('readyOppWager');
    oppDiv.innerHTML = '';
    var oppHasItems = false;
    ITEM_ORDER.forEach(function(itemKey) {
        var count = oppWager[itemKey];
        if (count > 0) {
            oppDiv.innerHTML += '<span class="ready-item">' + ITEM_CONFIG[itemKey].icon + 'x' + count + '</span>';
            oppHasItems = true;
        }
    });
    if (!oppHasItems) oppDiv.innerHTML = '<span style="color:var(--text-muted)">Nothing</span>';
    
    // Render pot (combined)
    var potDiv = document.getElementById('readyPot');
    potDiv.innerHTML = '';
    var potHasItems = false;
    ITEM_ORDER.forEach(function(itemKey) {
        var total = (myWager[itemKey] || 0) + (oppWager[itemKey] || 0);
        if (total > 0) {
            potDiv.innerHTML += '<span class="ready-item">' + ITEM_CONFIG[itemKey].icon + 'x' + total + '</span>';
            potHasItems = true;
        }
    });
    if (!potHasItems) potDiv.innerHTML = '<span style="color:var(--text-muted)">No wagers</span>';
    
    updateReadyStatus();
    document.getElementById('wagerReadyOverlay').classList.remove('hidden');
}

function hideWagerReady() {
    document.getElementById('wagerReadyOverlay').classList.add('hidden');
}

// ============================================
// Ready Status
// ============================================
function updateReadyStatus() {
    var statusDiv = document.getElementById('readyStatus');
    var readyBtn = document.getElementById('readyBtn');
    
    if (wagerState.myReady && wagerState.oppReady) {
        statusDiv.innerHTML = '<span class="ready">Both ready! Starting...</span>';
    } else if (wagerState.myReady) {
        statusDiv.innerHTML = '<span class="waiting">Waiting for opponent...</span>';
        readyBtn.disabled = true;
        readyBtn.textContent = 'Waiting...';
    } else if (wagerState.oppReady) {
        statusDiv.innerHTML = '<span class="ready">Opponent is ready!</span>';
    } else {
        statusDiv.innerHTML = '<span class="waiting">Click Ready when prepared</span>';
    }
}

function setOpponentReady() {
    wagerState.oppReady = true;
    updateReadyStatus();
}

// ============================================
// Confirm Ready
// ============================================
function confirmReady() {
    wagerState.myReady = true;
    updateReadyStatus();
    
    // Notify server
    if (typeof sendPlayerReady === 'function') {
        sendPlayerReady();
    }
}

// ============================================
// Cancel Ready
// ============================================
function cancelReady() {
    hideWagerReady();
    resetWagerState();
    
    // Notify server
    if (typeof sendCancelReady === 'function') {
        sendCancelReady();
    }
    
    // Callback for game
    if (typeof onWagerCancelled === 'function') {
        onWagerCancelled();
    }
}

// ============================================
// Handle Wager Messages from Server
// ============================================
function handleWagerMessage(msg) {
    switch (msg.type) {
        case 'wager_updated':
            updateOpponentWager(msg.wager);
            break;

        case 'opponent_wager_confirmed':
            wagerState.oppConfirmed = true;
            document.getElementById('wagerOppStatus').textContent = '✓ Confirmed';
            document.getElementById('wagerOppStatus').classList.add('confirmed');
            break;

        case 'wagers_locked':
            showWagerReady(msg.myWager, msg.oppWager);
            break;

        case 'opponent_ready':
            setOpponentReady();
            break;

        case 'both_ready':
            hideWagerReady();
            // Game will handle countdown
            if (typeof onBothReady === 'function') {
                onBothReady(msg.countdown);
            }
            break;

        case 'opponent_cancelled_wager':
            hideWagerSelect();
            hideWagerReady();
            resetWagerState();
            if (typeof onOpponentLeftWager === 'function') {
                onOpponentLeftWager();
            }
            break;
    }
}

// ============================================
// Get Current Wager
// ============================================
function getMyWager() {
    return wagerState.myWager;
}

function isWagerConfirmed() {
    return wagerState.myConfirmed;
}
