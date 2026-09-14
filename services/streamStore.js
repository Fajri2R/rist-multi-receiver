const fs = require('fs');
const path = require('path');
const dataPath = path.join(__dirname, '../data/streams.json');

function loadStreams() {
    if (!fs.existsSync(dataPath)) {
        return [];
    }
    return JSON.parse(fs.readFileSync(dataPath, 'utf8'));
}

function saveStreams(streams) {
    fs.writeFileSync(dataPath, JSON.stringify(streams, null, 2), 'utf8');
}

module.exports = {
    getAll: loadStreams,
    saveAll: saveStreams
};
