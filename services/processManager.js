const { spawn } = require('child_process');
const config = require('../config');
const statsCollector = require('./statsCollector');

const runningProcs = {};

function buildReceiverCmd(stream) {
    // session-timeout=5000 (5s) gives Android time to re-auth when source port changes mid-handshake
    // keepalive=1 ensures RTCP ping stays active even when bitrate drops to 0 temporarily on Android
    const listenUrl = `rist://@:${stream.receivePort}?rtt-min=${config.rttMin}&rtt-max=${config.rttMax}&username=${stream.username}&password=${stream.password}`;
    const outputUrl  = `udp://127.0.0.1:${stream.internalPort}`;
    const statsUrl   = `127.0.0.1:${stream.statsPort}`;
    return { cmd: 'ristreceiver', args: ['-v', '6', '-b', config.receiverBuffer, '-i', listenUrl, '-o', outputUrl, '-r', statsUrl, '-p', config.ristProfile] };
}

function buildSenderCmd(stream) {
    const inputUrl  = `udp://@127.0.0.1:${stream.internalPort}`;
    // AES-128 encryption with the per-stream playbackSecret so OBS can authenticate
    const listenUrl = `rist://@:${stream.forwardPort}?cname=${stream.streamId}&aes-type=128&secret=${stream.playbackSecret}`;
    return { cmd: 'ristsender', args: ['-v', '-1', '-i', inputUrl, '-o', listenUrl, '-p', config.ristProfile] };
}

function startStream(stream) {
    if (runningProcs[stream.streamId]) return;
    const rec = buildReceiverCmd(stream);
    const snd = buildSenderCmd(stream);

    let recProc;
    try {
        recProc = spawn(rec.cmd, rec.args, { stdio: 'pipe' });

        let outBuffer = '';
        const handleOutput = (d) => {
            const chunk = d.toString();
            outBuffer += chunk;
            let lines = outBuffer.split('\n');
            outBuffer = lines.pop();
            for (const line of lines) {
                process.stdout.write(`[REC:${stream.streamId.slice(0,8)}] ${line}\n`);
                if (line.includes('{"schema_version"')) {
                    const jsonStart = line.indexOf('{');
                    if (jsonStart !== -1) {
                        statsCollector.handleRawJson(stream.streamId, line.substring(jsonStart));
                    }
                }
            }
        };

        if (recProc.stdout) recProc.stdout.on('data', handleOutput);
        if (recProc.stderr) recProc.stderr.on('data', handleOutput);
        recProc.on('error', () => {});
    } catch (e) {
        console.warn(`[ProcessManager] Exception launching receiver:`, e.message);
    }

    const timer = setTimeout(() => {
        try {
            const sndProc = spawn(snd.cmd, snd.args, { stdio: 'pipe' });
            if (sndProc.stdout) sndProc.stdout.on('data', d => process.stdout.write(`[SND:${stream.streamId.slice(0,8)}] ${d}`));
            if (sndProc.stderr) sndProc.stderr.on('data', d => process.stderr.write(`[SND:${stream.streamId.slice(0,8)}] ${d}`));
            sndProc.on('error', () => {});
            if (runningProcs[stream.streamId]) runningProcs[stream.streamId].sender = sndProc;
        } catch (e) {}
    }, 2000);

    runningProcs[stream.streamId] = { receiver: recProc, sender: null, timer };
    console.log(`[ProcessManager] Started stream ${stream.streamId.slice(0,8)} [Recv:${stream.receivePort} -> Fwd:${stream.forwardPort}] [AES-128 enabled]`);
}

function stopStream(streamId) {
    const procs = runningProcs[streamId];
    if (!procs) return;
    clearTimeout(procs.timer);
    if (procs.receiver && !procs.receiver.killed) procs.receiver.kill();
    if (procs.sender   && !procs.sender.killed)   procs.sender.kill();
    delete runningProcs[streamId];
    console.log(`[ProcessManager] Stopped stream ${streamId.slice(0,8)}`);
}

module.exports = { startStream, stopStream };



