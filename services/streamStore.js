const fs = require('fs');
const path = require('path');
const dataDir = path.join(__dirname, '../data');
const dataPath = path.join(dataDir, 'streams.json');
const backupPath = path.join(dataDir, 'streams.json.bak');

function loadStreams() {
    if (!fs.existsSync(dataPath)) {
        return [];
    }
    try {
        const parsed = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        console.error('[StreamStore] streams.json is unreadable, leaving it on disk:', e.message);
        return [];
    }
}

function saveStreams(streams) {
    if (!Array.isArray(streams)) {
        throw new Error('saveStreams expects an array');
    }
    // Keep the previous good state so an accidental wipe stays recoverable.
    if (fs.existsSync(dataPath)) {
        try {
            fs.copyFileSync(dataPath, backupPath);
        } catch (e) {
            console.warn('[StreamStore] Could not write the backup copy:', e.message);
        }
    }
    fs.writeFileSync(dataPath, JSON.stringify(streams, null, 2), 'utf8');
}

module.exports = {
    getAll: loadStreams,
    saveAll: saveStreams
};
