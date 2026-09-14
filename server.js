const express = require('express');
const crypto = require('crypto');
const path = require('path');
const os = require('os');
const https = require('https');
const config = require('./config');
const store = require('./services/streamStore');
const procManager = require('./services/processManager');
const statsCollector = require('./services/statsCollector');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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

function allocatePorts() {
    let rec = config.receivePortStart;
    let fwd = config.forwardPortStart;
    let internal = config.internalPortStart;
    let stat = config.statsPortStart;

    // RIST Main profile requires EVEN ports and takes port + 1 for RTCP feedback
    // So ports MUST increment by 2 to prevent collision!
    streams.forEach(s => {
        if (s.receivePort >= rec) rec = s.receivePort + 2;
        if (s.forwardPort >= fwd) fwd = s.forwardPort + 2;
        if (s.internalPort >= internal) internal = s.internalPort + 2;
        if (s.statsPort >= stat) stat = s.statsPort + 1;
    });
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
            if (!err && address) {
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

app.post('/api/streams', (req, res) => {
    const { name, username, password } = req.body;
    const streamId = crypto.randomUUID().replace(/-/g, '');
    const ports = allocatePorts();
    
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
    console.log(`[Manager] Server running on http://0.0.0.0:${PORT}`);
    console.log(`[Manager] Added OpenIRL NOALBS stats proxy layer.`);
    fetchPublicIp().then(ip => {
        if (ip) console.log(`[Manager] Detected Public IP: ${ip}`);
    });
});




