/**
 * Ylem Inventory Module
 * Handles: Inventory overlay display, item selection, item earned animation
 * Auto-injects HTML overlays
 * 
 * Requires: config.js loaded first
 * 
 * API:
 *   initInventory() - Call on page load
 *   showInventory() - Open inventory overlay
 *   hideInventory() - Close inventory overlay
 *   updateInventory(inv) - Update inventory data
 *   showItemEarned(rolls, newInventory) - Show item drop animation
 */

// ============================================
// State
// ============================================
const inventoryState = {
    inventory: {},
    selectedItem: null
};

// Callback when item earned popup closes
let onItemEarnedClosed = null;

// ============================================
// Initialize
// ============================================
function initInventory() {
    inventoryState.inventory = getEmptyInventory();
    injectInventoryHTML();
    setupInventoryScrollListeners();
}

// ============================================
// Update Inventory Data
// ============================================
function updateInventory(newInventory) {
    inventoryState.inventory = newInventory || getEmptyInventory();
}

function getInventory() {
    return inventoryState.inventory;
}

// ============================================
// Show/Hide
// ============================================
function showInventory() {
    if (typeof isAuthenticated === 'function' && !isAuthenticated()) {
        showAccountChooser();
        return;
    }
    inventoryState.selectedItem = null;
    renderInventoryGrid();
    updateInventoryDetails();
    document.getElementById('invOverlay').classList.remove('hidden');
}

function hideInventory() {
    document.getElementById('invOverlay').classList.add('hidden');
    stopDetailsAutoScroll();
}

// ============================================
// Render Grid
// ============================================
function renderInventoryGrid() {
    const grid = document.getElementById('invGrid');
    if (!grid) return;
    grid.innerHTML = '';
    
    const totalSlots = 20;
    let slotIndex = 0;
    
    ITEM_ORDER.forEach(function(itemKey) {
        const count = inventoryState.inventory[itemKey] || 0;
        if (count > 0) {
            const item = ITEM_CONFIG[itemKey];
            const slot = document.createElement('div');
            slot.className = 'inv-slot has-item rarity-' + item.rarity;
            slot.dataset.item = itemKey;
            slot.innerHTML = '<span class="inv-slot-icon">' + item.icon + '</span><span class="inv-slot-count">' + count + '</span>';
            slot.onclick = function() { selectInventoryItem(itemKey); };
            grid.appendChild(slot);
            slotIndex++;
        }
    });
    
    for (let i = slotIndex; i < totalSlots; i++) {
        const slot = document.createElement('div');
        slot.className = 'inv-slot';
        grid.appendChild(slot);
    }
}

// ============================================
// Item Selection
// ============================================
function selectInventoryItem(itemKey) {
    inventoryState.selectedItem = itemKey;
    
    document.querySelectorAll('.inv-slot').forEach(function(slot) {
        slot.classList.toggle('selected', slot.dataset.item === itemKey);
    });
    
    updateInventoryDetails();
}

function updateInventoryDetails() {
    const details = document.getElementById('invDetails');
    if (!details) return;
    
    if (!inventoryState.selectedItem) {
        details.innerHTML = '<div class="inv-details-empty">Select an item to view details</div>';
        return;
    }
    
    const item = ITEM_CONFIG[inventoryState.selectedItem];
    const count = inventoryState.inventory[inventoryState.selectedItem] || 0;
    const rarityDisplay = item.rarity.charAt(0).toUpperCase() + item.rarity.slice(1);
    
    details.innerHTML = 
        '<div class="inv-details-header">' +
            '<div class="inv-details-icon">' + item.icon + '</div>' +
            '<div class="inv-details-title">' +
                '<div class="inv-details-name rarity-' + item.rarity + '">' + item.name + '</div>' +
                '<div class="inv-details-type">' + item.type + '</div>' +
            '</div>' +
        '</div>' +
        '<div class="inv-details-stats">' +
            '<div class="inv-stat"><span class="inv-stat-label">Owned</span><span class="inv-stat-value">' + count + '</span></div>' +
            '<div class="inv-stat"><span class="inv-stat-label">Rarity</span><span class="inv-stat-value rarity-' + item.rarity + '">' + rarityDisplay + '</span></div>' +
        '</div>' +
        '<div class="inv-details-lore">"' + item.lore + '"</div>';
    
    details.scrollTop = 0;
    startDetailsAutoScroll();
}

// ============================================
// Auto-scroll
// ============================================
let detailsScrollTimeout = null;
let detailsAutoScrollInterval = null;
let detailsScrollDirection = 1;
let detailsManualScrolling = false;

function startDetailsAutoScroll() {
    const details = document.getElementById('invDetails');
    if (!details) return;
    
    stopDetailsAutoScroll();
    detailsScrollDirection = 1;
    detailsManualScrolling = false;
    
    detailsScrollTimeout = setTimeout(function() {
        detailsAutoScrollInterval = setInterval(function() {
            if (detailsManualScrolling) return;
            const maxScroll = details.scrollHeight - details.clientHeight;
            if (maxScroll <= 5) return;
            details.scrollTop += detailsScrollDirection * 0.5;
            if (details.scrollTop >= maxScroll) detailsScrollDirection = -1;
            else if (details.scrollTop <= 0) detailsScrollDirection = 1;
        }, 30);
    }, 500);
}

function stopDetailsAutoScroll() {
    if (detailsAutoScrollInterval) clearInterval(detailsAutoScrollInterval);
    if (detailsScrollTimeout) clearTimeout(detailsScrollTimeout);
}

function setupInventoryScrollListeners() {
    setTimeout(function() {
        const details = document.getElementById('invDetails');
        if (!details) return;
        
        let manualScrollTimeout = null;
        
        function handleStart() {
            detailsManualScrolling = true;
            if (manualScrollTimeout) clearTimeout(manualScrollTimeout);
        }
        
        function handleEnd() {
            if (manualScrollTimeout) clearTimeout(manualScrollTimeout);
            manualScrollTimeout = setTimeout(function() { detailsManualScrolling = false; }, 5000);
        }
        
        details.addEventListener('touchstart', handleStart);
        details.addEventListener('touchend', handleEnd);
        details.addEventListener('mousedown', handleStart);
        details.addEventListener('mouseup', handleEnd);
        details.addEventListener('wheel', function() { handleStart(); handleEnd(); });
    }, 200);
}

// ============================================
// Item Earned Animation
// ============================================
function showItemEarned(rolls, newInventory) {
    const overlay = document.getElementById('itemEarnedOverlay');
    const rollsContainer = document.getElementById('itemEarnedRolls');
    if (!overlay || !rollsContainer) return;
    
    rollsContainer.innerHTML = '';
    
    rolls.forEach(function(item, i) {
        setTimeout(function() {
            const div = document.createElement('div');
            div.className = 'item-roll';
            if (RARE_ITEMS.includes(item)) div.classList.add('rare');
            div.innerHTML = '<span class="item-roll-icon">' + ITEM_CONFIG[item].icon + '</span><span class="item-roll-name">' + ITEM_CONFIG[item].name + '</span>';
            rollsContainer.appendChild(div);
        }, i * 300);
    });
    
    if (newInventory) {
        inventoryState.inventory = newInventory;
        if (typeof authState !== 'undefined') authState.inventory = newInventory;
    }
    
    overlay.classList.remove('hidden');
}

function closeItemEarned() {
    document.getElementById('itemEarnedOverlay').classList.add('hidden');
    renderInventoryGrid();
    if (onItemEarnedClosed) onItemEarnedClosed();
}

// ============================================
// HTML Injection
// ============================================
function injectInventoryHTML() {
    const html = `
        <!-- Inventory Overlay -->
        <div class="inv-overlay hidden" id="invOverlay">
            <div class="inv-content">
                <div class="inv-header">
                    <div class="inv-title">⚔️ Item Storage</div>
                </div>
                <div class="inv-main">
                    <div class="inv-grid-section">
                        <div class="inv-grid" id="invGrid"></div>
                    </div>
                    <div class="inv-details" id="invDetails">
                        <div class="inv-details-empty">Select an item to view details</div>
                    </div>
                </div>
                <div class="inv-footer">
                    <button class="inv-close-btn" onclick="hideInventory()">Close</button>
                </div>
            </div>
        </div>

        <!-- Item Earned Overlay -->
        <div class="item-earned-overlay hidden" id="itemEarnedOverlay">
            <div class="item-earned-title">✨ Items Earned!</div>
            <div class="item-earned-rolls" id="itemEarnedRolls"></div>
            <button class="item-earned-btn" onclick="closeItemEarned()">Continue</button>
        </div>
    `;
    
    const container = document.createElement('div');
    container.id = 'inventory-container';
    container.innerHTML = html;
    document.body.appendChild(container);
}
