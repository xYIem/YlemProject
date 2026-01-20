/**
 * Dictionary Module
 * Trie data structure for fast word lookups
 * Word list loading and validation
 */

// ============================================
// Trie Data Structure
// ============================================
function TrieNode() {
    this.children = {};
    this.isWord = false;
}

function Trie() {
    this.root = new TrieNode();
}

Trie.prototype.insert = function(word) {
    var node = this.root;
    for (var i = 0; i < word.length; i++) {
        var char = word[i];
        if (!node.children[char]) {
            node.children[char] = new TrieNode();
        }
        node = node.children[char];
    }
    node.isWord = true;
};

Trie.prototype.has = function(word) {
    var node = this.root;
    for (var i = 0; i < word.length; i++) {
        var char = word[i];
        if (!node.children[char]) return false;
        node = node.children[char];
    }
    return node.isWord;
};

Trie.prototype.hasPrefix = function(prefix) {
    var node = this.root;
    for (var i = 0; i < prefix.length; i++) {
        var char = prefix[i];
        if (!node.children[char]) return false;
        node = node.children[char];
    }
    return true;
};

// ============================================
// Dictionary State
// ============================================
const dictionaryState = {
    trie: null,
    loaded: false,
    loading: false,
    wordCount: 0
};

// ============================================
// Load Dictionary
// ============================================
async function loadDictionary(url) {
    console.log('[DICTIONARY] loadDictionary called, loaded:', dictionaryState.loaded, 'loading:', dictionaryState.loading);
    
    if (dictionaryState.loaded || dictionaryState.loading) {
        console.log('[DICTIONARY] Already loaded or loading, returning:', dictionaryState.loaded);
        return dictionaryState.loaded;
    }

    dictionaryState.loading = true;
    
    // Try local first, then fallback to GitHub
    var urls = [
        '/wordlist.js',
        'https://raw.githubusercontent.com/christianp/nulac/master/2of12inf.txt'
    ];
    
    if (url) {
        urls = [url];
    }

    for (var i = 0; i < urls.length; i++) {
        var dictUrl = urls[i];
        try {
            console.log('[DICTIONARY] Trying:', dictUrl);
            var response = await fetch(dictUrl);
            console.log('[DICTIONARY] Response status:', response.status);
            
            if (!response.ok) {
                console.log('[DICTIONARY] Response not ok, continuing');
                continue;
            }

            console.log('[DICTIONARY] Getting text...');
            var text = await response.text();
            console.log('[DICTIONARY] Got text, length:', text.length);
            
            // Split on newlines OR spaces (handle both formats)
            console.log('[DICTIONARY] Splitting...');
            var words = text.split(/[\n\s]+/)
                .map(function(w) { return w.trim().toUpperCase(); })
                .filter(function(w) { return w.length >= 3 && /^[A-Z]+$/.test(w); });
            console.log('[DICTIONARY] Split done, words:', words.length);

            console.log('[DICTIONARY] Creating Trie...');
            dictionaryState.trie = new Trie();
            
            console.log('[DICTIONARY] Inserting words...');
            for (var j = 0; j < words.length; j++) {
                dictionaryState.trie.insert(words[j]);
            }
            console.log('[DICTIONARY] Insert done');

            dictionaryState.wordCount = words.length;
            dictionaryState.loaded = true;
            dictionaryState.loading = false;

            console.log('[DICTIONARY] Loaded', words.length, 'words from', dictUrl);
            return true;

        } catch (error) {
            console.log('[DICTIONARY] Error loading from', dictUrl, ':', error.message);
            continue;
        }
    }
    
    console.error('[DICTIONARY] Failed to load from all sources');
    dictionaryState.loading = false;
    return false;
}

// ============================================
// Word Validation
// ============================================
function isValidWord(word) {
    if (!dictionaryState.trie) return false;
    return dictionaryState.trie.has(word.toUpperCase());
}

function hasPrefix(prefix) {
    if (!dictionaryState.trie) return false;
    return dictionaryState.trie.hasPrefix(prefix.toUpperCase());
}

function isDictionaryLoaded() {
    return dictionaryState.loaded;
}

function getWordCount() {
    return dictionaryState.wordCount;
}

// ============================================
// Get Trie (for solvers)
// ============================================
function getTrie() {
    return dictionaryState.trie;
}
