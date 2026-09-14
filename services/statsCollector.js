const dgram = require('dgram');

const statsStore = {}; // streamId -> { lastUpdate, stats }
const sockets = {}; // streamId -> dgram socket

function parseStatsData(data) {
    let bitrate = 0;
    let rtt = 0;
    let quality = 100;
    let loss = 0;
    let peerCount = 0;

    if (!data || typeof data !== 'object') {
        return null;
    }

    // Format libRIST schema_version 5 (digunakan oleh librist terbaru)
    if (data['receiver-stats'] && data['receiver-stats'].flowinstant) {
        const flow = data['receiver-stats'].flowinstant;
        if (flow.stats) {
            bitrate = flow.stats.bitrate || flow.stats.bitrate_payload || 0;
            quality = flow.stats.quality !== undefined ? flow.stats.quality : 100;
            loss = flow.stats.lost || 0;
        }
        if (flow.peers && Array.isArray(flow.peers)) {
            peerCount = flow.peers.length;
            const activePeer = flow.peers[0];
            if (activePeer && activePeer.stats) {
                rtt = activePeer.stats.rtt || activePeer.stats.avg_rtt || 0;
                if (!bitrate && activePeer.stats.bitrate) {
                    bitrate = activePeer.stats.bitrate;
                }
            }
        }
    } 
    // Fallback untuk format lawas
    else if (data.receiver && data.receiver.peers) {
        peerCount = data.receiver.peers.length;
        data.receiver.peers.forEach(peer => {
            bitrate += peer.cur_bitrate || peer.bitrate || 0;
            rtt = Math.max(rtt, peer.rtt || 0);
        });
    }

    return {
        bitrate: Math.round(bitrate),
        rtt: Math.round(rtt * 10) / 10,
        quality,
        loss,
        peerCount
    };
}

function updateStats(streamId, parsed) {
    if (!parsed) return;
    statsStore[streamId] = {
        lastUpdate: Date.now(),
        online: true,
        bitrate: parsed.bitrate,
        rtt: parsed.rtt,
        quality: parsed.quality,
        loss: parsed.loss,
        peerCount: parsed.peerCount
    };
}

function handleRawJson(streamId, jsonStr) {
    try {
        const data = JSON.parse(jsonStr);
        const parsed = parseStatsData(data);
        if (parsed) {
            updateStats(streamId, parsed);
        }
    } catch (e) {}
}

function startCollecting(stream) {
    if (sockets[stream.streamId]) return;

    const socket = dgram.createSocket('udp4');
    
    socket.on('message', (msg) => {
        handleRawJson(stream.streamId, msg.toString());
    });

    socket.on('error', (err) => {
        console.error(`[StatsSocket Error ${stream.streamId.slice(0,8)}]`, err.message);
    });

    socket.bind(stream.statsPort, '127.0.0.1', () => {
        console.log(`[StatsCollector] Listening for UDP stats of ${stream.streamId.slice(0,8)} on port ${stream.statsPort}`);
    });

    sockets[stream.streamId] = socket;
}

function stopCollecting(streamId) {
    if (sockets[streamId]) {
        sockets[streamId].close();
        delete sockets[streamId];
    }
    delete statsStore[streamId];
}

function getStats(streamId) {
    const entry = statsStore[streamId];
    if (!entry) {
        return { online: false, bitrate: 0, rtt: 0, quality: 100, loss: 0, lastUpdate: 0 };
    }
    // Jika tidak ada data lebih dari 4 detik, anggap offline
    const isOnline = (Date.now() - entry.lastUpdate) < 4000;
    return {
        ...entry,
        online: isOnline,
        bitrate: isOnline ? entry.bitrate : 0,
        rtt: isOnline ? entry.rtt : 0
    };
}

function getNoalbsStats(streamId) {
    const stats = getStats(streamId);
    return {
        publishers: {
            [`live/${streamId}`]: {
                streamId: `live/${streamId}`,
                bitrate: stats.online ? stats.bitrate : 0,
                rtt: stats.online ? stats.rtt : 0,
                loss: stats.loss || 0,
                connected: stats.online,
                clients: stats.peerCount || 0
            }
        }
    };
}

module.exports = {
    startCollecting,
    stopCollecting,
    handleRawJson,
    getStats,
    getNoalbsStats
};
