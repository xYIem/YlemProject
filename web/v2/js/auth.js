/**
 * Ylem Auth Module
 * Handles: WebSocket, account creation, login, session management, name change
 * Auto-injects HTML overlays, no setup needed in parent page
 * 
 * Requires: config.js loaded first
 * 
 * API:
 *   initAuth(options) - Call on page load
 *   isAuthenticated() - Check if logged in
 *   getPlayerName() - Get current player name
 *   getSessionToken() - Get session token
 *   showAccountChooser() - Show login/create popup
 *   onAuthSuccess - Set callback: function(inventory) {}
 */

// ============================================
// State
// ============================================
const authState = {
    authenticated: false,
    sessionToken: null,
    playerName: null,
    inventory: {},
    ws: null,
    wsReady: false,
    createPin: '',
    loginPin: '',
    changeNamePin: '',
    messageQueue: []
};

// Callback when auth succeeds
let onAuthSuccess = null;

// ============================================
// Random Name Generator
// ============================================
const NAME_PARTS = {
    prefixes: ['Pickle', 'Chunky', 'Soggy', 'Crispy', 'Spicy', 'Funky', 'Sneaky', 'Sweaty', 'Salty', 'Chonky', 'Thicc', 'Smol', 'Captain', 'Doctor', 'Lord', 'Sir', 'Big', 'Lil', 'MC', 'DJ', 'Feral', 'Chaotic', 'Sigma', 'Gigachad', 'Certified', 'Professional', 'Bootleg', 'Discount'],
    middles: ['Waffle', 'Nugget', 'Pickle', 'Taco', 'Bean', 'Noodle', 'Potato', 'Goblin', 'Gremlin', 'Cowboy', 'Wizard', 'Ninja', 'Pirate', 'Hamster', 'Raccoon', 'Goose', 'Shrimp', 'Lobster', 'Donut', 'Burrito', 'Sock', 'Pants', 'Yeet', 'Bonk', 'Chungus', 'Stonks', 'Cheese', 'Bacon', 'Capybara', 'Frog'],
    suffixes: ['Master', 'Lord', 'King', 'Queen', 'Slayer', 'Destroyer', 'Lover', 'Whisperer', 'Gamer', 'Legend', 'Champion', 'Enjoyer', 'Hater', 'Stan', '9000', 'Pro', 'Jr'],
    numbers: ['69', '420', '99', '007', '360', '42', '1337']
};

function generateRandomName() {
    const patterns = [
        () => NAME_PARTS.prefixes[Math.floor(Math.random() * NAME_PARTS.prefixes.length)] + NAME_PARTS.middles[Math.floor(Math.random() * NAME_PARTS.middles.length)] + NAME_PARTS.numbers[Math.floor(Math.random() * NAME_PARTS.numbers.length)],
        () => NAME_PARTS.middles[Math.floor(Math.random() * NAME_PARTS.middles.length)] + NAME_PARTS.suffixes[Math.floor(Math.random() * NAME_PARTS.suffixes.length)],
        () => NAME_PARTS.prefixes[Math.floor(Math.random() * NAME_PARTS.prefixes.length)] + NAME_PARTS.middles[Math.floor(Math.random() * NAME_PARTS.middles.length)]
    ];
    return patterns[Math.floor(Math.random() * patterns.length)]().substring(0, 18);
}

// ============================================
// WebSocket
// ============================================
function connectAuthWs() {
    if (authState.ws && authState.ws.readyState === WebSocket.OPEN) return;
    
    // Use ws:// for http, wss:// for https
    const wsProtocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
    const wsUrl = wsProtocol + window.location.host + '/ws/';
    
    try {
        authState.ws = new WebSocket(wsUrl);
        
        authState.ws.onopen = function() {
            console.log('[Auth] WebSocket connected');
            authState.wsReady = true;
            updateMenuStatus('Connected');
            
            // Process queued messages
            while (authState.messageQueue.length > 0) {
                const msg = authState.messageQueue.shift();
                authState.ws.send(JSON.stringify(msg));
            }
            
            // Check for existing session
            const savedSession = localStorage.getItem('item_session');
            const savedName = localStorage.getItem('boggle_playerName');
            if (savedSession && savedName) {
                // Have both - verify with server
                sendAuthMessage({
                    type: 'verify_session',
                    name: savedName,
                    sessionToken: savedSession
                });
            } else {
                // Missing session or name - show account chooser
                console.log('[Auth] No valid session, showing account chooser');
                showAccountChooser();
            }
        };
        
        authState.ws.onmessage = function(event) {
            const msg = JSON.parse(event.data);
            handleAuthWsMessage(msg);
        };
        
        authState.ws.onerror = function(err) {
            console.error('[Auth] WebSocket error:', err);
            updateMenuStatus('Connection error');
        };
        
        authState.ws.onclose = function() {
            console.log('[Auth] WebSocket disconnected');
            authState.wsReady = false;
            updateMenuStatus('Disconnected');
            setTimeout(connectAuthWs, 3000);
        };
    } catch (e) {
        console.error('[Auth] Failed to connect:', e);
    }
}

function sendAuthMessage(msg) {
    if (authState.ws && authState.ws.readyState === WebSocket.OPEN) {
        authState.ws.send(JSON.stringify(msg));
    } else {
        authState.messageQueue.push(msg);
        connectAuthWs();
    }
}

function handleAuthWsMessage(msg) {
    console.log('[Auth] Received:', msg.type);
    
    // Pass to inventory module if it's an items message
    if (msg.type === 'items_rolled' && typeof handleItemsRolled === 'function') {
        handleItemsRolled(msg);
        return;
    }
    
    // Pass leaderboard messages through
    if ((msg.type === 'leaderboard_data' || msg.type === 'score_saved') && typeof handleLeaderboardMessage === 'function') {
        handleLeaderboardMessage(msg);
        return;
    }
    
    switch (msg.type) {
        case 'session_status':
            if (msg.valid) {
                authState.authenticated = true;
                // Use msg.name (canonical name from server) if provided
                authState.playerName = msg.name || localStorage.getItem('boggle_playerName') || 'Player';
                authState.sessionToken = localStorage.getItem('item_session');
                authState.inventory = msg.inventory || getEmptyInventory();
                // Update localStorage with canonical name if server provided it
                if (msg.name) {
                    localStorage.setItem('boggle_playerName', msg.name);
                }
                updateMenuStatus('Welcome back, ' + authState.playerName);
                if (typeof updateInventory === 'function') {
                    updateInventory(authState.inventory);
                }
                if (onAuthSuccess) onAuthSuccess(authState.inventory);
            } else {
                localStorage.removeItem('item_session');
                localStorage.removeItem('boggle_playerName');
                showAccountChooser();
            }
            break;
            
        case 'pin_created':
            if (msg.success) {
                authState.authenticated = true;
                authState.playerName = document.getElementById('authCreateNameInput').value.trim();
                authState.sessionToken = msg.sessionToken;
                authState.inventory = msg.inventory || getEmptyInventory();
                localStorage.setItem('item_session', msg.sessionToken);
                localStorage.setItem('boggle_playerName', authState.playerName);
                hideAllAuthOverlays();
                updateMenuStatus('Welcome, ' + authState.playerName);
                if (typeof updateInventory === 'function') {
                    updateInventory(authState.inventory);
                }
                if (onAuthSuccess) onAuthSuccess(authState.inventory);
            } else {
                showAuthError('authCreateError', msg.error || 'Name already taken');
            }
            break;
            
        case 'pin_verified':
            if (msg.success) {
                authState.authenticated = true;
                // Use canonicalName from server if provided (preserves original casing)
                authState.playerName = msg.canonicalName || document.getElementById('authLoginNameInput').value.trim();
                authState.sessionToken = msg.sessionToken;
                authState.inventory = msg.inventory || getEmptyInventory();
                localStorage.setItem('item_session', msg.sessionToken);
                localStorage.setItem('boggle_playerName', authState.playerName);
                hideAllAuthOverlays();
                updateMenuStatus('Welcome back, ' + authState.playerName);
                if (typeof updateInventory === 'function') {
                    updateInventory(authState.inventory);
                }
                if (onAuthSuccess) onAuthSuccess(authState.inventory);
            } else {
                showAuthError('authLoginError', msg.error || 'Wrong name or PIN');
                authState.loginPin = '';
                document.getElementById('authLoginPinDisplay').textContent = '';
            }
            break;
            
        case 'name_changed':
            if (msg.success) {
                // Use newName from server if provided
                const newName = msg.newName || document.getElementById('authChangeNameInput').value.trim();
                authState.playerName = newName;
                authState.sessionToken = msg.sessionToken;
                localStorage.setItem('boggle_playerName', newName);
                localStorage.setItem('item_session', msg.sessionToken);
                hideAllAuthOverlays();
                updateMenuStatus('Name changed to ' + newName);
            } else {
                showAuthError('authChangeNameError', msg.error || 'Name already taken');
            }
            break;
    }
}

// ============================================
// UI Updates
// ============================================
function updateMenuStatus(text) {
    const el = document.getElementById('menuStatus');
    if (el) el.textContent = text;
}

function showAuthError(id, msg) {
    const el = document.getElementById(id);
    if (el) {
        el.textContent = msg;
        el.classList.remove('hidden');
    }
}

// ============================================
// Overlay Functions
// ============================================
function showAccountChooser() {
    const notLoggedIn = document.getElementById('authNotLoggedIn');
    const loggedIn = document.getElementById('authLoggedIn');
    const loggedInName = document.getElementById('authLoggedInName');
    
    // Check both authState AND localStorage (in case WS hasn't verified yet)
    const savedSession = localStorage.getItem('item_session');
    const savedName = localStorage.getItem('boggle_playerName');
    const isLoggedIn = authState.authenticated || (savedSession && savedName);
    const displayName = authState.playerName || savedName || 'Player';
    
    if (isLoggedIn) {
        // Show logged in view
        notLoggedIn.style.display = 'none';
        loggedIn.style.display = 'block';
        loggedInName.textContent = 'Logged in as: ' + displayName;
    } else {
        // Show login/create options
        notLoggedIn.style.display = 'block';
        loggedIn.style.display = 'none';
    }
    
    document.getElementById('authAccountOverlay').classList.remove('hidden');
}

function hideAccountChooser() {
    document.getElementById('authAccountOverlay').classList.add('hidden');
}

function signOut() {
    // Clear local storage
    localStorage.removeItem('item_session');
    localStorage.removeItem('boggle_playerName');
    
    // Clear auth state
    authState.authenticated = false;
    authState.playerName = null;
    authState.sessionToken = null;
    authState.inventory = getEmptyInventory();
    
    // Update UI
    updateMenuStatus('Signed out');
    hideAllAuthOverlays();
    
    // Show login chooser
    setTimeout(function() {
        showAccountChooser();
    }, 100);
}

function showCreateAccount() {
    hideAccountChooser();
    const savedName = localStorage.getItem('boggle_playerName');
    document.getElementById('authCreateNameInput').value = savedName || generateRandomName();
    authState.createPin = '';
    document.getElementById('authCreatePinDisplay').textContent = '';
    document.getElementById('authCreateError').classList.add('hidden');
    document.getElementById('authCreateOverlay').classList.remove('hidden');
}

function showLoginAccount() {
    hideAccountChooser();
    const savedName = localStorage.getItem('boggle_playerName');
    document.getElementById('authLoginNameInput').value = savedName || '';
    authState.loginPin = '';
    document.getElementById('authLoginPinDisplay').textContent = '';
    document.getElementById('authLoginError').classList.add('hidden');
    document.getElementById('authLoginOverlay').classList.remove('hidden');
}

function showChangeName() {
    hideAccountChooser();
    document.getElementById('authChangeNameInput').value = '';
    authState.changeNamePin = '';
    document.getElementById('authChangeNamePinDisplay').textContent = '';
    document.getElementById('authChangeNameError').classList.add('hidden');
    document.getElementById('authChangeNameOverlay').classList.remove('hidden');
}

function backToAccountChooser() {
    document.getElementById('authCreateOverlay').classList.add('hidden');
    document.getElementById('authLoginOverlay').classList.add('hidden');
    document.getElementById('authChangeNameOverlay').classList.add('hidden');
    showAccountChooser();
}

function hideAllAuthOverlays() {
    document.getElementById('authAccountOverlay').classList.add('hidden');
    document.getElementById('authCreateOverlay').classList.add('hidden');
    document.getElementById('authLoginOverlay').classList.add('hidden');
    document.getElementById('authChangeNameOverlay').classList.add('hidden');
}

function randomizeCreateName() {
    document.getElementById('authCreateNameInput').value = generateRandomName();
}

function randomizeChangeName() {
    document.getElementById('authChangeNameInput').value = generateRandomName();
}

// ============================================
// PIN Input
// ============================================
function authCreatePinInput(digit) {
    if (authState.createPin.length < 18) {
        authState.createPin += digit;
        document.getElementById('authCreatePinDisplay').textContent = authState.createPin;
    }
}

function authCreatePinDelete() {
    authState.createPin = authState.createPin.slice(0, -1);
    document.getElementById('authCreatePinDisplay').textContent = authState.createPin;
}

function authLoginPinInput(digit) {
    if (authState.loginPin.length < 18) {
        authState.loginPin += digit;
        document.getElementById('authLoginPinDisplay').textContent = authState.loginPin;
    }
}

function authLoginPinDelete() {
    authState.loginPin = authState.loginPin.slice(0, -1);
    document.getElementById('authLoginPinDisplay').textContent = authState.loginPin;
}

function authChangeNamePinInput(digit) {
    if (authState.changeNamePin.length < 18) {
        authState.changeNamePin += digit;
        document.getElementById('authChangeNamePinDisplay').textContent = authState.changeNamePin;
    }
}

function authChangeNamePinDelete() {
    authState.changeNamePin = authState.changeNamePin.slice(0, -1);
    document.getElementById('authChangeNamePinDisplay').textContent = authState.changeNamePin;
}

// ============================================
// Submit Functions
// ============================================
function confirmCreateAccount() {
    const name = document.getElementById('authCreateNameInput').value.trim();
    const pin = authState.createPin;
    
    if (!name) {
        showAuthError('authCreateError', 'Please enter a name');
        return;
    }
    // Check for consecutive spaces
    if (/\s{2,}/.test(name)) {
        showAuthError('authCreateError', 'Name cannot have consecutive spaces');
        return;
    }
    if (pin.length < 1) {
        showAuthError('authCreateError', 'Please enter a PIN');
        return;
    }
    
    sendAuthMessage({ type: 'create_pin', name: name, pin: pin });
}

function confirmLogin() {
    const name = document.getElementById('authLoginNameInput').value.trim();
    const pin = authState.loginPin;
    
    if (!name) {
        showAuthError('authLoginError', 'Please enter your name');
        return;
    }
    if (pin.length < 1) {
        showAuthError('authLoginError', 'Please enter your PIN');
        return;
    }
    
    sendAuthMessage({ type: 'verify_pin', name: name, pin: pin });
}

function confirmChangeName() {
    const newName = document.getElementById('authChangeNameInput').value.trim();
    const pin = authState.changeNamePin;
    const oldName = authState.playerName || localStorage.getItem('boggle_playerName');
    const sessionToken = authState.sessionToken || localStorage.getItem('item_session');
    
    if (!newName) {
        showAuthError('authChangeNameError', 'Please enter a new name');
        return;
    }
    // Check for consecutive spaces
    if (/\s{2,}/.test(newName)) {
        showAuthError('authChangeNameError', 'Name cannot have consecutive spaces');
        return;
    }
    // Case-insensitive comparison for "already your name"
    if (newName.toLowerCase() === (oldName || '').toLowerCase()) {
        showAuthError('authChangeNameError', 'That\'s already your name!');
        return;
    }
    if (pin.length < 1) {
        showAuthError('authChangeNameError', 'Please enter your PIN to confirm');
        return;
    }
    
    sendAuthMessage({ 
        type: 'change_name', 
        oldName: oldName,
        newName: newName, 
        pin: pin,
        sessionToken: sessionToken
    });
}

// ============================================
// Public API
// ============================================
function isAuthenticated() {
    return authState.authenticated;
}

function getPlayerName() {
    return authState.playerName;
}

function getSessionToken() {
    return authState.sessionToken;
}

function getAuthInventory() {
    return authState.inventory;
}

// ============================================
// HTML Injection
// ============================================
function injectAuthHTML() {
    const html = `
        <!-- Account Chooser / Account Menu -->
        <div class="auth-overlay hidden" id="authAccountOverlay">
            <div class="auth-content">
                <div id="authNotLoggedIn">
                    <div class="auth-title">🎮 Welcome!</div>
                    <div class="auth-subtitle">Create an account to save your items and compete on leaderboards</div>
                    <div class="auth-buttons">
                        <button class="auth-btn create" onclick="showCreateAccount()">Create Account</button>
                        <button class="auth-btn login" onclick="showLoginAccount()">Log In</button>
                        <button class="auth-back-btn" onclick="hideAllAuthOverlays()">Cancel</button>
                    </div>
                </div>
                <div id="authLoggedIn" style="display: none;">
                    <div class="auth-title">👤 Account</div>
                    <div class="auth-subtitle" id="authLoggedInName">Logged in as: </div>
                    <div class="auth-buttons">
                        <button class="auth-btn create" onclick="showChangeName()">Change Name</button>
                        <button class="auth-btn login" onclick="signOut()">Sign Out</button>
                        <button class="auth-back-btn" onclick="hideAllAuthOverlays()">Close</button>
                    </div>
                </div>
            </div>
        </div>

        <!-- Create Account -->
        <div class="auth-overlay hidden" id="authCreateOverlay">
            <div class="auth-content">
                <div class="auth-title">✨ Create Account</div>
                <div class="auth-subtitle">Choose a name and PIN</div>
                <input type="text" class="auth-input" id="authCreateNameInput" maxlength="18" placeholder="Your Name" autocomplete="off">
                <div class="auth-random" onclick="randomizeCreateName()">✨ Random Name ✨</div>
                <div class="auth-pin-label">Enter a PIN (visible, 1-18 digits)</div>
                <div class="auth-pin-display" id="authCreatePinDisplay"></div>
                <div class="auth-pin-pad">
                    <button class="pin-btn" onclick="authCreatePinInput('1')">1</button>
                    <button class="pin-btn" onclick="authCreatePinInput('2')">2</button>
                    <button class="pin-btn" onclick="authCreatePinInput('3')">3</button>
                    <button class="pin-btn" onclick="authCreatePinInput('4')">4</button>
                    <button class="pin-btn" onclick="authCreatePinInput('5')">5</button>
                    <button class="pin-btn" onclick="authCreatePinInput('6')">6</button>
                    <button class="pin-btn" onclick="authCreatePinInput('7')">7</button>
                    <button class="pin-btn" onclick="authCreatePinInput('8')">8</button>
                    <button class="pin-btn" onclick="authCreatePinInput('9')">9</button>
                    <button class="pin-btn delete" onclick="authCreatePinDelete()">⌫</button>
                    <button class="pin-btn" onclick="authCreatePinInput('0')">0</button>
                    <button class="pin-btn confirm" onclick="confirmCreateAccount()">✓</button>
                </div>
                <div class="auth-error hidden" id="authCreateError"></div>
                <button class="auth-back-btn" onclick="backToAccountChooser()">Back</button>
            </div>
        </div>

        <!-- Login -->
        <div class="auth-overlay hidden" id="authLoginOverlay">
            <div class="auth-content">
                <div class="auth-title">🔐 Log In</div>
                <div class="auth-subtitle">Enter your name and PIN</div>
                <input type="text" class="auth-input" id="authLoginNameInput" maxlength="18" placeholder="Your Name" autocomplete="off">
                <div class="auth-pin-label">Enter your PIN</div>
                <div class="auth-pin-display" id="authLoginPinDisplay"></div>
                <div class="auth-pin-pad">
                    <button class="pin-btn" onclick="authLoginPinInput('1')">1</button>
                    <button class="pin-btn" onclick="authLoginPinInput('2')">2</button>
                    <button class="pin-btn" onclick="authLoginPinInput('3')">3</button>
                    <button class="pin-btn" onclick="authLoginPinInput('4')">4</button>
                    <button class="pin-btn" onclick="authLoginPinInput('5')">5</button>
                    <button class="pin-btn" onclick="authLoginPinInput('6')">6</button>
                    <button class="pin-btn" onclick="authLoginPinInput('7')">7</button>
                    <button class="pin-btn" onclick="authLoginPinInput('8')">8</button>
                    <button class="pin-btn" onclick="authLoginPinInput('9')">9</button>
                    <button class="pin-btn delete" onclick="authLoginPinDelete()">⌫</button>
                    <button class="pin-btn" onclick="authLoginPinInput('0')">0</button>
                    <button class="pin-btn confirm" onclick="confirmLogin()">✓</button>
                </div>
                <div class="auth-error hidden" id="authLoginError"></div>
                <button class="auth-back-btn" onclick="backToAccountChooser()">Back</button>
            </div>
        </div>

        <!-- Change Name -->
        <div class="auth-overlay hidden" id="authChangeNameOverlay">
            <div class="auth-content">
                <div class="auth-title">✏️ Change Name</div>
                <div class="auth-subtitle">Enter your new name and PIN to confirm</div>
                <input type="text" class="auth-input" id="authChangeNameInput" maxlength="18" placeholder="New Name" autocomplete="off">
                <div class="auth-random" onclick="randomizeChangeName()">✨ Random Name ✨</div>
                <div class="auth-pin-label">Enter your PIN to confirm</div>
                <div class="auth-pin-display" id="authChangeNamePinDisplay"></div>
                <div class="auth-pin-pad">
                    <button class="pin-btn" onclick="authChangeNamePinInput('1')">1</button>
                    <button class="pin-btn" onclick="authChangeNamePinInput('2')">2</button>
                    <button class="pin-btn" onclick="authChangeNamePinInput('3')">3</button>
                    <button class="pin-btn" onclick="authChangeNamePinInput('4')">4</button>
                    <button class="pin-btn" onclick="authChangeNamePinInput('5')">5</button>
                    <button class="pin-btn" onclick="authChangeNamePinInput('6')">6</button>
                    <button class="pin-btn" onclick="authChangeNamePinInput('7')">7</button>
                    <button class="pin-btn" onclick="authChangeNamePinInput('8')">8</button>
                    <button class="pin-btn" onclick="authChangeNamePinInput('9')">9</button>
                    <button class="pin-btn delete" onclick="authChangeNamePinDelete()">⌫</button>
                    <button class="pin-btn" onclick="authChangeNamePinInput('0')">0</button>
                    <button class="pin-btn confirm" onclick="confirmChangeName()">✓</button>
                </div>
                <div class="auth-error hidden" id="authChangeNameError"></div>
                <button class="auth-back-btn" onclick="backToAccountChooser()">Back</button>
            </div>
        </div>
    `;
    
    const container = document.createElement('div');
    container.id = 'auth-container';
    container.innerHTML = html;
    document.body.appendChild(container);
}

// ============================================
// Init
// ============================================
function initAuth(options = {}) {
    injectAuthHTML();
    connectAuthWs();
}
