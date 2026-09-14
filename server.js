const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const config = require('./config');
const store = require('./services/streamStore');
const procManager = require('./services/processManager');
const statsCollector = require('./services/statsCollector');

// ==========================================
// API KEY AUTHENTICATION INITIALIZATION
// ==========================================
const apiKeyPath = path.join(__dirname, 'data/.apikey');
let API_KEY = '';

if (fs.existsSync(apiKeyPath)) {
    API_KEY = fs.readFileSync(apiKeyPath, 'utf8').trim();
} else {
    // Generate secure 32-character random hex API key
    API_KEY = crypto.randomBytes(16).toString('hex');
    fs.writeFileSync(apiKeyPath, API_KEY, 'utf8');
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// SECURITY: Rate Limiter & Timing-Safe Auth
// ==========================================
const rateLimitCache = {};

function getClientIp(req) {
    let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
    if (typeof ip === 'string') {
        ip = ip.split(',')[0].trim();
        if (ip.startsWith('::ffff:')) ip = ip.replace('::ffff:', '');
    }
    return ip;
}

// Check if an IP belongs to private LAN / loopback / Docker networks (RFC 1918)
function isPrivateOrLocalIp(ip) {
    if (!ip) return false;
    // Loopback
    if (ip === '127.0.0.1' || ip === '::1' || ip === 'localhost') return true;
    
    // Class A: 10.0.0.0 - 10.255.255.255 (Your Wi-Fi & Ethernet)
    if (ip.startsWith('10.')) return true;
    
    // Class C: 192.168.0.0 - 192.168.255.255 (Home LAN)
    if (ip.startsWith('192.168.')) return true;
    
    // Class B / Docker Bridges: 172.16.0.0 - 172.31.255.255
    if (ip.startsWith('172.')) {
        const second = parseInt(ip.split('.')[1], 10);
        if (second >= 16 && second <= 31) return true;
    }
    
    // Link-Local: 169.254.0.0 - 169.254.255.255
    if (ip.startsWith('169.254.')) return true;
    
    return false;
}

function isRateLimited(ip) {
    // Local / Private LAN IPs are WHITELISTED from brute-force lockout
    if (isPrivateOrLocalIp(ip)) {
        return false;
    }

    const record = rateLimitCache[ip];
    if (!record) return false;
    if (record.lockoutUntil > 0) {
        if (Date.now() < record.lockoutUntil) {
            return true;
        }
        // Lockout period has elapsed, fully clear the record
        delete rateLimitCache[ip];
        return false;
    }
    return false;
}

function recordFailedAttempt(ip) {
    // Local IPs still get logged for security visibility, but never locked out
    if (isPrivateOrLocalIp(ip)) {
        console.warn(`[AUTH] Failed auth attempt from local IP ${ip} (Local exemption: no lockout)`);
        return 0;
    }

    const now = Date.now();
    if (!rateLimitCache[ip]) {
        rateLimitCache[ip] = { attempts: 1, lockoutUntil: 0, firstAttempt: now };
    } else {
        // If attempts are older than 10 minutes, reset window
        if (now - rateLimitCache[ip].firstAttempt > 600000 && rateLimitCache[ip].lockoutUntil === 0) {
            rateLimitCache[ip] = { attempts: 1, lockoutUntil: 0, firstAttempt: now };
        } else {
            rateLimitCache[ip].attempts += 1;
        }
    }
    
    const count = rateLimitCache[ip].attempts;
    if (count >= 5 && rateLimitCache[ip].lockoutUntil === 0) {
        rateLimitCache[ip].lockoutUntil = now + 600000; // 10 minutes lockout
        console.warn(`[SECURITY ALERT] Public IP ${ip} has been LOCKED OUT for 10 minutes (5 failed attempts).`);
    } else if (count < 5) {
        console.warn(`[SECURITY] Failed auth attempt from Public IP ${ip} (${count}/5)`);
    }
    return count;
}

function resetAttempts(ip) {
    delete rateLimitCache[ip];
}

function secureCompare(clientKey) {
    if (!clientKey || typeof clientKey !== 'string') return false;
    const a = crypto.createHash('sha256').update(clientKey.trim()).digest();
    const b = crypto.createHash('sha256').update(API_KEY).digest();
    return crypto.timingSafeEqual(a, b);
}

// Verify API Key endpoint (public so UI can check if key is valid)
app.post('/api/auth/verify', (req, res) => {
    const ip = getClientIp(req);
    
    // 1. Check if IP is currently locked out
    if (isRateLimited(ip)) {
        return res.status(429).json({ success: false, error: 'Too many failed attempts. IP locked out for 10 minutes.' });
    }

    const { key } = req.body;

    // 2. Validate Key
    if (secureCompare(key)) {
        resetAttempts(ip);
        return res.json({ success: true, valid: true });
    }
    
    // 3. Increment failure count
    const currentAttempts = recordFailedAttempt(ip);
    const isLocal = isPrivateOrLocalIp(ip);

    if (!isLocal && currentAttempts >= 5) {
        return res.status(429).json({ success: false, error: 'Too many failed attempts. IP locked out for 10 minutes.' });
    }

    const remainingMsg = isLocal ? 'Invalid API key. Please check and try again.' : `Invalid API key. ${Math.max(0, 5 - currentAttempts)} attempt(s) remaining.`;

    // Artificial timing jitter (150-350ms) to thwart automated brute-force scripts
    setTimeout(() => {
        return res.status(401).json({ success: false, error: remainingMsg });
    }, isLocal ? 50 : (Math.floor(Math.random() * 200) + 150));
});

// Authentication Guard Middleware for Protected API routes
function requireApiKey(req, res, next) {
    const ip = getClientIp(req);
    if (isRateLimited(ip)) {
        return res.status(429).json({ error: 'Unauthorized: IP locked due to brute-force' });
    }

    const clientKey = req.headers['x-api-key'] || (req.headers['authorization'] ? req.headers['authorization'].replace(/^Bearer\s+/i, '') : '');
    
    if (!secureCompare(clientKey)) {
        recordFailedAttempt(ip);
        return res.status(401).json({ error: 'Unauthorized: Invalid or missing API key' });
    }
    
    resetAttempts(ip);
    next();
}

// Protect all /api/streams and /api/system-info routes
app.use('/api/streams', requireApiKey);
app.use('/api/system-info', requireApiKey);

let streams = store.getAll();

// Patch existing streams to have playbackSecret if they don't have one
let storeNeedsUpdate = false;
streams.forEach(s => {
    if (!s.playbackSecret) {
        s.playbackSecret = crypto.randomBytes(16).toString('hex');
        storeNeedsUpdate = true;
    }
});
if (storeNeedsUpdate) store.saveAll(streams);

streams.forEach(stream => {
    if (stream.active !== false) {
        procManager.startStream(stream);
        statsCollector.startCollecting(stream);
    }
});

const net = require('net');
const dgram = require('dgram');

// Port Probing Helper: Checks if a UDP port is available
function checkUdpPortAvailable(port) {
    return new Promise((resolve) => {
        const socket = dgram.createSocket('udp4');
        socket.once('error', () => resolve(false));
        socket.once('listening', () => {
            socket.close();
            resolve(true);
        });
        socket.bind(port, '0.0.0.0');
    });
}

// Function to safely allocate next available ports by probing the system directly
async function allocatePorts() {
    let rec = config.receivePortStart;
    let fwd = config.forwardPortStart;
    let internal = config.internalPortStart;
    let stat = config.statsPortStart;

    // First skip ports currently known by our database logic
    streams.forEach(s => {
        if (s.receivePort >= rec) rec = s.receivePort + 2;
        if (s.forwardPort >= fwd) fwd = s.forwardPort + 2;
        if (s.internalPort >= internal) internal = s.internalPort + 2;
        if (s.statsPort >= stat) stat = s.statsPort + 1;
    });

    // RIST needs pairs: (port and port+1). We verify BOTH are available.
    // Probing Receiver Port Pair
    while (!(await checkUdpPortAvailable(rec)) || !(await checkUdpPortAvailable(rec + 1))) {
        console.warn(`[Port Allocator] Port ${rec} or ${rec+1} is busy, trying ${rec + 2}`);
        rec += 2;
    }

    // Probing Forward Port Pair
    while (!(await checkUdpPortAvailable(fwd)) || !(await checkUdpPortAvailable(fwd + 1))) {
        console.warn(`[Port Allocator] Port ${fwd} or ${fwd+1} is busy, trying ${fwd + 2}`);
        fwd += 2;
    }

    // Probing Internal UDP Port (only 1 needed per receiver, but we keep steps of 2 to be safe)
    while (!(await checkUdpPortAvailable(internal))) {
        internal += 2;
    }

    // Probing Stats UDP Port
    while (!(await checkUdpPortAvailable(stat))) {
        stat += 1;
    }

    return { rec, fwd, internal, stat };
}

// IP Detection helpers
let cachedPublicIp = null;
let lastPublicIpFetch = 0;

function fetchPublicIp() {
    return new Promise((resolve) => {
        // Cache public IP for 10 minutes
        if (cachedPublicIp && (Date.now() - lastPublicIpFetch < 600000)) {
            return resolve(cachedPublicIp);
        }
        https.get('https://api.ipify.org?format=json', { timeout: 3500 }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    if (parsed.ip) {
                        cachedPublicIp = parsed.ip;
                        lastPublicIpFetch = Date.now();
                    }
                    resolve(cachedPublicIp);
                } catch (e) {
                    resolve(cachedPublicIp);
                }
            });
        }).on('error', () => resolve(cachedPublicIp));
    });
}

function isDockerBridge(address) {
    // Docker default bridge ranges: 172.17.0.0/12 (172.16 - 172.31)
    const parts = address.split('.').map(Number);
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    // Docker compose internal networks also use 172.x
    return false;
}

function getLocalIps() {
    const interfaces = os.networkInterfaces();
    const regular = [];
    const docker  = [];
    for (const name of Object.keys(interfaces)) {
        for (const net of interfaces[name]) {
            if (net.family !== 'IPv4' || net.internal) continue;
            if (isDockerBridge(net.address)) {
                docker.push({ interface: name, address: net.address });
            } else {
                regular.push({ interface: name, address: net.address });
            }
        }
    }
    // Real LAN IPs first, Docker bridges appended last
    return [...regular, ...docker];
}

const dns = require('dns');

function resolveHostIp() {
    return new Promise((resolve) => {
        if (process.env.HOST_IP) {
            return resolve(process.env.HOST_IP);
        }
        // Try resolving host.docker.internal (supported by Docker Desktop Windows/Mac)
        dns.lookup('host.docker.internal', (err, address) => {
            // Filter out Docker Desktop virtual gateway (192.168.65.x)
            if (!err && address && !address.startsWith('192.168.65.')) {
                resolve(address);
            } else {
                resolve(null);
            }
        });
    });
}

// REST API: System info (IP detection)
app.get('/api/system-info', async (req, res) => {
    const publicIp = await fetchPublicIp();
    const localIps = getLocalIps();
    const hostDockerIp = await resolveHostIp();
    const reqHost = req.headers.host ? req.headers.host.split(':')[0] : 'localhost';
    res.json({
        publicIp: publicIp || null,
        localIps,
        hostDockerIp: hostDockerIp || null,
        requestHost: reqHost
    });
});

app.get('/api/streams', (req, res) => {
    const withStats = streams.map(s => {
        const liveStats = statsCollector.getStats(s.streamId);
        return { ...s, liveStats };
    });
    res.json(withStats);
});

app.post('/api/streams', async (req, res) => {
    const { name, username, password } = req.body;
    const streamId = crypto.randomUUID().replace(/-/g, '');
    const ports = await allocatePorts();
    
    const newStream = {
        id: crypto.randomUUID(),
        streamId,
        name: name || `Stream-${streamId.substring(0,6)}`,
        receivePort: ports.rec,
        forwardPort: ports.fwd,
        internalPort: ports.internal,
        statsPort: ports.stat,
        username: username || 'user',
        password: password || 'pass',
        playbackSecret: crypto.randomBytes(16).toString('hex'),
        createdAt: new Date().toISOString(),
        active: true
    };
    
    streams.push(newStream);
    store.saveAll(streams);

    procManager.startStream(newStream);
    statsCollector.startCollecting(newStream);

    res.json(newStream);
});

app.put('/api/streams/:id', (req, res) => {
    const streamIdx = streams.findIndex(s => s.id === req.params.id);
    if (streamIdx === -1) return res.status(404).json({error: 'Not found'});
    
    const { username, password } = req.body;
    const stream = streams[streamIdx];
    
    // Hentikan proses lama
    procManager.stopStream(stream.streamId);
    statsCollector.stopCollecting(stream.streamId);
    
    // Perbarui data
    if (username !== undefined) stream.username = username;
    if (password !== undefined) stream.password = password;
    
    store.saveAll(streams);
    
    // Mulai proses baru dengan kredensial baru
    procManager.startStream(stream);
    statsCollector.startCollecting(stream);
    
    res.json(stream);
});

app.delete('/api/streams/:id', (req, res) => {
    const streamIdx = streams.findIndex(s => s.id === req.params.id);
    if (streamIdx === -1) return res.status(404).json({error: 'Not found'});
    
    const stream = streams[streamIdx];
    procManager.stopStream(stream.streamId);
    statsCollector.stopCollecting(stream.streamId);
    
    streams.splice(streamIdx, 1);
    store.saveAll(streams);
    res.json({ success: true });
});

app.get('/stats/:streamId', (req, res) => {
    const { streamId } = req.params;
    res.json(statsCollector.getNoalbsStats(streamId));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n========================================================`);
    console.log(`🔐 RIST MULTI-RECEIVER MANAGEMENT API KEY:`);
    console.log(`   ${API_KEY}`);
    console.log(`   (Saved in ./data/.apikey)`);
    console.log(`========================================================\n`);
    console.log(`[Manager] Server running on http://0.0.0.0:${PORT}`);
    console.log(`[Manager] Added OpenIRL NOALBS stats proxy layer.`);
    fetchPublicIp().then(ip => {
        if (ip) console.log(`[Manager] Detected Public IP: ${ip}`);
    });
});













