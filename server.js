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

    streams.forEach(s => {
        if (s.receivePort >= rec) rec = s.receivePort + 1;
        if (s.forwardPort >= fwd) fwd = s.forwardPort + 1;
        if (s.internalPort >= internal) internal = s.internalPort + 1;
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

function getLocalIps() {
    const interfaces = os.networkInterfaces();
    const ips = [];
    for (const name of Object.keys(interfaces)) {
        for (const net of interfaces[name]) {
            if (net.family === 'IPv4' && !net.internal) {
                // Filter out standard docker internal bridges if host IPs exist
                ips.push({ interface: name, address: net.address });
            }
        }
    }
    return ips;
}

// REST API: System info (IP detection)
app.get('/api/system-info', async (req, res) => {
    const publicIp = await fetchPublicIp();
    const localIps = getLocalIps();
    // Also include client request remote IP / host header
    const reqHost = req.headers.host ? req.headers.host.split(':')[0] : 'localhost';
    res.json({
        publicIp: publicIp || null,
        localIps,
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
