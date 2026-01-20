/**
 * EPG Server for Ylem TV
 * 
 * HTTP server that:
 * 1. Serves EPG data via /api/epg endpoint
 * 2. Auto-refreshes data every 4 hours
 * 3. Downloads and caches channel logos locally
 * 4. Serves logos via /logos/ endpoint
 * 
 * Usage: node epg-server.js
 * 
 * Endpoints:
 *   GET /api/epg              - Returns full EPG JSON
 *   GET /api/epg/now          - Returns only currently playing shows
 *   GET /api/epg/channel/:id  - Returns programmes for specific channel
 *   GET /api/epg/refresh      - Force refresh EPG data
 *   GET /api/epg/logos/:file  - Serves cached logo images
 *   GET /health               - Health check
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

// Configuration
const CONFIG = {
    // Server settings
    serverPort: parseInt(process.env.PORT) || 3001,
    
    // ErsatzTV settings
    ersatztvHost: process.env.HOST_IP || 'localhost',
    ersatztvPort: parseInt(process.env.ERSATZTV_PORT) || 8409,
    xmltvPath: '/iptv/xmltv.xml',
    m3uPath: '/iptv/channels.m3u',
    
    // EPG settings
    hoursBefore: 2,
    hoursAfter: 24,
    refreshIntervalMs: 4 * 60 * 60 * 1000, // 4 hours
    
    // Logo settings
    logoDir: path.join(__dirname, 'logos'),
    logoRefreshMs: 24 * 60 * 60 * 1000, // 24 hours
    
    // File output
    outputPath: path.join(__dirname, 'epg.json')
};

// In-memory EPG cache
let epgCache = null;
let lastRefresh = null;
let lastLogoRefresh = null;

// Ensure logos directory exists
if (!fs.existsSync(CONFIG.logoDir)) {
    fs.mkdirSync(CONFIG.logoDir, { recursive: true });
    console.log(`Created logos directory: ${CONFIG.logoDir}`);
}

/**
 * Fetch data from a URL using http (text)
 */
function fetchData(host, port, urlPath) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: host,
            port: port,
            path: urlPath,
            method: 'GET',
            timeout: 30000
        };

        console.log(`  Fetching: http://${host}:${port}${urlPath}`);

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve(data);
                } else {
                    reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
                }
            });
        });

        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timed out'));
        });

        req.end();
    });
}

/**
 * Download a binary file (logo image)
 */
function downloadFile(host, port, urlPath, destPath) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: host,
            port: port,
            path: urlPath,
            method: 'GET',
            timeout: 15000
        };

        const req = http.request(options, (res) => {
            if (res.statusCode === 200) {
                const fileStream = fs.createWriteStream(destPath);
                res.pipe(fileStream);
                fileStream.on('finish', () => {
                    fileStream.close();
                    resolve(true);
                });
                fileStream.on('error', (err) => {
                    fs.unlink(destPath, () => {}); // Delete partial file
                    reject(err);
                });
            } else if (res.statusCode === 301 || res.statusCode === 302) {
                // Handle redirect
                const redirectUrl = res.headers.location;
                if (redirectUrl) {
                    const url = new URL(redirectUrl, `http://${host}:${port}`);
                    downloadFile(url.hostname, url.port || port, url.pathname + url.search, destPath)
                        .then(resolve)
                        .catch(reject);
                } else {
                    reject(new Error('Redirect without location'));
                }
            } else {
                reject(new Error(`HTTP ${res.statusCode}`));
            }
        });

        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Download timed out'));
        });

        req.end();
    });
}

/**
 * Download logo from ErsatzTV and save locally
 * Returns the local filename or null if failed
 */
async function downloadLogo(logoUrl, channelNumber) {
    if (!logoUrl) return null;
    
    try {
        // Parse the URL to get the path
        let urlPath;
        if (logoUrl.startsWith('http')) {
            const url = new URL(logoUrl);
            urlPath = url.pathname + url.search;
        } else {
            urlPath = logoUrl;
        }
        
        // Generate a safe filename based on channel number
        const ext = urlPath.includes('.png') ? '.png' : 
                   urlPath.includes('.jpg') ? '.jpg' : 
                   urlPath.includes('.jpeg') ? '.jpeg' : '.png';
        const filename = `ch${channelNumber}${ext}`;
        const destPath = path.join(CONFIG.logoDir, filename);
        
        // Check if logo already exists and is recent (skip if less than 24hrs old)
        if (fs.existsSync(destPath)) {
            const stats = fs.statSync(destPath);
            const age = Date.now() - stats.mtimeMs;
            if (age < CONFIG.logoRefreshMs) {
                return filename; // Use cached logo
            }
        }
        
        // Download the logo
        await downloadFile(CONFIG.ersatztvHost, CONFIG.ersatztvPort, urlPath, destPath);
        console.log(`    ✓ Downloaded logo: ${filename}`);
        return filename;
        
    } catch (error) {
        console.log(`    ✗ Failed to download logo for ch${channelNumber}: ${error.message}`);
        return null;
    }
}

/**
 * Parse XMLTV format
 */
function parseXMLTV(xmlString) {
    const channels = [];
    const programmes = [];

    console.log(`  Parsing XMLTV (${xmlString.length} bytes)...`);

    // Extract channels
    const channelRegex = /<channel\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/channel>/gi;
    let channelMatch;
    
    while ((channelMatch = channelRegex.exec(xmlString)) !== null) {
        const channelId = channelMatch[1];
        const channelContent = channelMatch[2];
        
        const nameMatch = channelContent.match(/<display-name[^>]*>([^<]+)<\/display-name>/i);
        const displayName = nameMatch ? decodeXMLEntities(nameMatch[1]) : channelId;
        
        const iconMatch = channelContent.match(/<icon\s+src="([^"]+)"/i);
        const logo = iconMatch ? iconMatch[1] : null;

        channels.push({ id: channelId, name: displayName, logo });
    }

    console.log(`  Found ${channels.length} channels`);

    // Extract programmes
    const programmeRegex = /<programme\s+start="([^"]+)"\s+stop="([^"]+)"\s+channel="([^"]+)"[^>]*>([\s\S]*?)<\/programme>/gi;
    let progMatch;

    while ((progMatch = programmeRegex.exec(xmlString)) !== null) {
        const startStr = progMatch[1];
        const stopStr = progMatch[2];
        const channelId = progMatch[3];
        const progContent = progMatch[4];

        const titleMatch = progContent.match(/<title[^>]*>([^<]+)<\/title>/i);
        const title = titleMatch ? decodeXMLEntities(titleMatch[1]) : 'Unknown';

        const subTitleMatch = progContent.match(/<sub-title[^>]*>([^<]+)<\/sub-title>/i);
        const subTitle = subTitleMatch ? decodeXMLEntities(subTitleMatch[1]) : null;

        const descMatch = progContent.match(/<desc[^>]*>([^<]+)<\/desc>/i);
        const description = descMatch ? decodeXMLEntities(descMatch[1]) : null;

        const categoryMatch = progContent.match(/<category[^>]*>([^<]+)<\/category>/i);
        const category = categoryMatch ? decodeXMLEntities(categoryMatch[1]) : null;

        const episodeMatch = progContent.match(/<episode-num\s+system="xmltv_ns"[^>]*>([^<]+)<\/episode-num>/i);
        let season = null, episode = null;
        if (episodeMatch) {
            const parts = episodeMatch[1].split('.');
            if (parts[0] && parts[0] !== '') season = parseInt(parts[0]) + 1;
            if (parts[1] && parts[1] !== '') episode = parseInt(parts[1]) + 1;
        }

        const iconMatch = progContent.match(/<icon\s+src="([^"]+)"/i);
        const icon = iconMatch ? iconMatch[1] : null;

        const start = parseXMLTVDate(startStr);
        const stop = parseXMLTVDate(stopStr);

        if (start && stop) {
            programmes.push({
                channelId, title, subTitle, description, category,
                season, episode, icon,
                start: start.toISOString(),
                stop: stop.toISOString(),
                startTimestamp: start.getTime(),
                stopTimestamp: stop.getTime()
            });
        }
    }

    console.log(`  Found ${programmes.length} programmes`);

    return { channels, programmes };
}

function parseXMLTVDate(dateStr) {
    if (!dateStr || dateStr.length < 14) return null;
    
    const year = parseInt(dateStr.substring(0, 4));
    const month = parseInt(dateStr.substring(4, 6)) - 1;
    const day = parseInt(dateStr.substring(6, 8));
    const hour = parseInt(dateStr.substring(8, 10));
    const minute = parseInt(dateStr.substring(10, 12));
    const second = parseInt(dateStr.substring(12, 14));

    const tzMatch = dateStr.match(/\s*([+-])(\d{2})(\d{2})$/);
    if (tzMatch) {
        const tzSign = tzMatch[1] === '+' ? 1 : -1;
        const tzHours = parseInt(tzMatch[2]);
        const tzMinutes = parseInt(tzMatch[3]);
        const tzOffset = tzSign * (tzHours * 60 + tzMinutes);
        
        const utcDate = new Date(Date.UTC(year, month, day, hour, minute, second));
        return new Date(utcDate.getTime() - tzOffset * 60 * 1000);
    }

    return new Date(year, month, day, hour, minute, second);
}

function decodeXMLEntities(str) {
    if (!str) return str;
    return str
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(dec))
        .replace(/&#x([0-9a-fA-F]+);/g, (match, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function parseM3U(m3uString) {
    const streams = {};
    const lines = m3uString.split('\n');
    let currentTvgId = null;
    let currentChannelNumber = null;

    console.log(`  Parsing M3U (${m3uString.length} bytes)...`);

    for (const line of lines) {
        const trimmed = line.trim();
        
        if (trimmed.startsWith('#EXTINF:')) {
            const tvgIdMatch = trimmed.match(/tvg-id="([^"]+)"/);
            currentTvgId = tvgIdMatch ? tvgIdMatch[1] : null;
            
            const chnoMatch = trimmed.match(/tvg-chno="([^"]+)"/);
            currentChannelNumber = chnoMatch ? chnoMatch[1] : null;
            
            const channelIdMatch = trimmed.match(/channel-id="([^"]+)"/);
            if (!currentChannelNumber && channelIdMatch) {
                currentChannelNumber = channelIdMatch[1];
            }
        } else if (trimmed.startsWith('http') && currentTvgId) {
            streams[currentTvgId] = {
                url: trimmed,
                channelNumber: currentChannelNumber
            };
            currentTvgId = null;
            currentChannelNumber = null;
        }
    }

    console.log(`  Found ${Object.keys(streams).length} streams`);

    return streams;
}

function filterProgrammes(programmes, hoursBefore, hoursAfter) {
    const now = Date.now();
    const windowStart = now - (hoursBefore * 60 * 60 * 1000);
    const windowEnd = now + (hoursAfter * 60 * 60 * 1000);

    return programmes.filter(prog => 
        prog.stopTimestamp > windowStart && prog.startTimestamp < windowEnd
    );
}

/**
 * Build EPG and download logos
 */
async function buildEPG(xmltvData, m3uStreams) {
    const { channels, programmes } = xmltvData;
    
    const filteredProgrammes = filterProgrammes(
        programmes, 
        CONFIG.hoursBefore, 
        CONFIG.hoursAfter
    );

    console.log(`  Downloading/checking logos...`);
    
    // Build channel list and download logos
    const channelList = [];
    for (const channel of channels) {
        const streamInfo = m3uStreams[channel.id] || {};
        let channelNumber = streamInfo.channelNumber;
        if (!channelNumber) {
            const numMatch = channel.id.match(/(\d+)/);
            channelNumber = numMatch ? numMatch[1] : null;
        }

        // Download logo and get local filename
        const localLogo = await downloadLogo(channel.logo, channelNumber);
        
        channelList.push({
            id: channel.id,
            name: channel.name,
            logo: localLogo ? `/api/epg/logos/${localLogo}` : null,
            number: channelNumber,
            streamUrl: streamInfo.url || null
        });
    }

    const programmesByChannel = {};
    for (const prog of filteredProgrammes) {
        if (!programmesByChannel[prog.channelId]) {
            programmesByChannel[prog.channelId] = [];
        }
        programmesByChannel[prog.channelId].push(prog);
    }

    for (const channelId in programmesByChannel) {
        programmesByChannel[channelId].sort((a, b) => a.startTimestamp - b.startTimestamp);
    }

    const now = new Date();
    const gridStart = new Date(now);
    gridStart.setHours(gridStart.getHours() - CONFIG.hoursBefore);
    gridStart.setMinutes(0, 0, 0);
    
    const gridEnd = new Date(now);
    gridEnd.setHours(gridEnd.getHours() + CONFIG.hoursAfter);
    gridEnd.setMinutes(0, 0, 0);

    return {
        generated: new Date().toISOString(),
        generatedTimestamp: Date.now(),
        timeWindow: {
            start: gridStart.toISOString(),
            end: gridEnd.toISOString(),
            startTimestamp: gridStart.getTime(),
            endTimestamp: gridEnd.getTime()
        },
        channels: channelList,
        programmes: programmesByChannel
    };
}

/**
 * Refresh EPG data from ErsatzTV
 */
async function refreshEPG() {
    console.log(`[${new Date().toISOString()}] Refreshing EPG data...`);
    
    try {
        const xmltvData = await fetchData(
            CONFIG.ersatztvHost,
            CONFIG.ersatztvPort,
            CONFIG.xmltvPath
        );
        
        const m3uData = await fetchData(
            CONFIG.ersatztvHost,
            CONFIG.ersatztvPort,
            CONFIG.m3uPath
        );
        
        const parsedXMLTV = parseXMLTV(xmltvData);
        const m3uStreams = parseM3U(m3uData);
        
        epgCache = await buildEPG(parsedXMLTV, m3uStreams);
        lastRefresh = new Date();
        
        // Also save to file
        fs.writeFileSync(CONFIG.outputPath, JSON.stringify(epgCache, null, 2));
        
        console.log(`[${new Date().toISOString()}] EPG refreshed: ${epgCache.channels.length} channels`);
        
        // Log channel details
        epgCache.channels.forEach(ch => {
            const progCount = epgCache.programmes[ch.id]?.length || 0;
            const logoStatus = ch.logo ? '✓' : '✗';
            console.log(`  ${logoStatus} Ch ${ch.number || '?'}: ${ch.name} (${progCount} programmes)`);
        });
        
        return true;
    } catch (error) {
        console.error(`[${new Date().toISOString()}] EPG refresh failed:`, error.message);
        return false;
    }
}

/**
 * Get currently playing shows
 */
function getNowPlaying() {
    if (!epgCache) return null;
    
    const now = Date.now();
    const nowPlaying = {};
    
    for (const channelId in epgCache.programmes) {
        const current = epgCache.programmes[channelId].find(prog => 
            prog.startTimestamp <= now && prog.stopTimestamp > now
        );
        if (current) {
            nowPlaying[channelId] = current;
        }
    }
    
    return {
        timestamp: new Date().toISOString(),
        channels: epgCache.channels,
        nowPlaying
    };
}

/**
 * Serve a logo image file
 */
function serveLogo(res, filename) {
    const filePath = path.join(CONFIG.logoDir, filename);
    
    if (!fs.existsSync(filePath)) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Logo not found');
        return;
    }
    
    const ext = path.extname(filename).toLowerCase();
    const contentType = ext === '.png' ? 'image/png' : 
                       ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 
                       ext === '.gif' ? 'image/gif' : 'application/octet-stream';
    
    const stats = fs.statSync(filePath);
    
    res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': stats.size,
        'Cache-Control': 'public, max-age=86400', // Cache for 24 hours
        'Access-Control-Allow-Origin': '*'
    });
    
    fs.createReadStream(filePath).pipe(res);
}

/**
 * Send JSON response
 */
function sendJSON(res, data, status = 200) {
    res.writeHead(status, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'max-age=60'
    });
    res.end(JSON.stringify(data));
}

/**
 * HTTP request handler
 */
function handleRequest(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;
    
    // Don't log logo requests to reduce noise
    if (!pathname.includes('/logos/')) {
        console.log(`[${new Date().toISOString()}] ${req.method} ${pathname}`);
    }
    
    // CORS preflight
    if (req.method === 'OPTIONS') {
        res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        });
        res.end();
        return;
    }
    
    // Routes
    if (pathname === '/health') {
        sendJSON(res, {
            status: 'ok',
            lastRefresh: lastRefresh?.toISOString(),
            channelCount: epgCache?.channels?.length || 0,
            logoDir: CONFIG.logoDir
        });
    } else if (pathname === '/api/epg' || pathname === '/api/epg/') {
        if (!epgCache) {
            sendJSON(res, { error: 'EPG not loaded yet' }, 503);
        } else {
            sendJSON(res, epgCache);
        }
    } else if (pathname === '/api/epg/now') {
        const nowPlaying = getNowPlaying();
        if (!nowPlaying) {
            sendJSON(res, { error: 'EPG not loaded yet' }, 503);
        } else {
            sendJSON(res, nowPlaying);
        }
    } else if (pathname.startsWith('/api/epg/logos/')) {
        // Serve logo images
        const filename = pathname.replace('/api/epg/logos/', '');
        serveLogo(res, filename);
    } else if (pathname.startsWith('/api/epg/channel/')) {
        const channelId = pathname.split('/').pop();
        if (!epgCache) {
            sendJSON(res, { error: 'EPG not loaded yet' }, 503);
        } else {
            const channel = epgCache.channels.find(c => c.id === channelId || c.number === channelId);
            const programmes = epgCache.programmes[channelId] || [];
            if (channel) {
                sendJSON(res, { channel, programmes });
            } else {
                sendJSON(res, { error: 'Channel not found' }, 404);
            }
        }
    } else if (pathname === '/api/epg/refresh') {
        // Manual refresh endpoint
        refreshEPG().then(success => {
            sendJSON(res, { success, lastRefresh: lastRefresh?.toISOString() });
        });
    } else {
        sendJSON(res, { error: 'Not found' }, 404);
    }
}

/**
 * Start the server
 */
async function main() {
    console.log('='.repeat(50));
    console.log('EPG Server for Ylem TV');
    console.log('='.repeat(50));
    console.log(`Port: ${CONFIG.serverPort}`);
    console.log(`ErsatzTV: http://${CONFIG.ersatztvHost}:${CONFIG.ersatztvPort}`);
    console.log(`XMLTV Path: ${CONFIG.xmltvPath}`);
    console.log(`M3U Path: ${CONFIG.m3uPath}`);
    console.log(`Logo Directory: ${CONFIG.logoDir}`);
    console.log(`Refresh interval: ${CONFIG.refreshIntervalMs / 1000 / 60} minutes`);
    console.log(`Logo refresh: ${CONFIG.logoRefreshMs / 1000 / 60 / 60} hours`);
    console.log('');
    
    // Initial EPG load
    await refreshEPG();
    
    // Schedule periodic refresh
    setInterval(refreshEPG, CONFIG.refreshIntervalMs);
    
    // Start HTTP server
    const server = http.createServer(handleRequest);
    server.listen(CONFIG.serverPort, () => {
        console.log('');
        console.log('Endpoints:');
        console.log(`  GET http://localhost:${CONFIG.serverPort}/api/epg         - Full EPG`);
        console.log(`  GET http://localhost:${CONFIG.serverPort}/api/epg/now     - Now playing`);
        console.log(`  GET http://localhost:${CONFIG.serverPort}/api/epg/logos/:file - Logo images`);
        console.log(`  GET http://localhost:${CONFIG.serverPort}/api/epg/channel/:id`);
        console.log(`  GET http://localhost:${CONFIG.serverPort}/api/epg/refresh - Force refresh`);
        console.log(`  GET http://localhost:${CONFIG.serverPort}/health          - Health check`);
        console.log('');
        console.log('Server running...');
    });
}

main();
