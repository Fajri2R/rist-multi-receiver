const { spawn } = require('child_process');
const config = require('../config');
const statsCollector = require('./statsCollector');

const runningProcs = {};
const restartState = {}; // streamId -> { attempts, timer }

const RESTART_BASE_MS = 2000;
const RESTART_MAX_MS = 60000;
const RESTART_RESET_UPTIME_MS = 60000;

function buildReceiverCmd(stream) {
    const params = [
        `buffer-min=${config.receiverBufferMin}`,
        `buffer-max=${config.receiverBufferMax}`,
        `bandwidth=${config.bandwidthKbps}`,
        `reorder-buffer=${config.reorderBuffer}`,
        `rtt-min=${config.rttMin}`,
        `rtt-max=${config.rttMax}`,
        `username=${stream.username}`,
        `password=${stream.password}`,
        `session-timeout=${config.sessionTimeout}`,
        `keepalive-interval=${config.keepaliveInterval}`,
        `congestion-control=1`
    ].join('&');

    const listenUrl = `rist://@:${stream.receivePort}?${params}`;
    const outputUrl = `udp://127.0.0.1:${stream.internalPort}`;
    const statsUrl  = `127.0.0.1:${stream.statsPort}`;
    // Override the link defaults from the URL; -b is dropped on purpose so
    // buffer-min/buffer-max govern the window instead of one flat value.
    return { cmd: 'ristreceiver', args: ['-v', '6', '-S', '1000', '-i', listenUrl, '-o', outputUrl, '-r', statsUrl, '-p', config.ristProfile] };
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
    const state = restartState[stream.streamId] || (restartState[stream.streamId] = { attempts: 0, timer: null });

    // Register entry BEFORE spawning so an immediate exit is still handled.
    const entry = { receiver: null, sender: null, timer: null, isShuttingDown: false, startedAt: Date.now() };
    runningProcs[stream.streamId] = entry;

    let recProc;
    try {
        recProc = spawn(rec.cmd, rec.args, { stdio: 'pipe' });
        entry.receiver = recProc;

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

    // --- Auto-Restart Crash Recovery Logic (exponential backoff) ---
    const handleCrash = (procName, code) => {
        const p = runningProcs[stream.streamId];
        // Ignore deliberate shutdowns via stopStream, and stale handlers of an older entry.
        if (!p || p !== entry || p.isShuttingDown) return;

        p.isShuttingDown = true; // prevents overlapping restarts
        clearTimeout(p.timer);
        if (p.receiver && !p.receiver.killed) p.receiver.kill();
        if (p.sender   && !p.sender.killed)   p.sender.kill();
        delete runningProcs[stream.streamId];

        // A session that stayed up long enough resets the backoff ladder.
        if (Date.now() - entry.startedAt > RESTART_RESET_UPTIME_MS) state.attempts = 0;
        state.attempts = Math.min(state.attempts + 1, 6);
        const delay = Math.min(RESTART_BASE_MS * Math.pow(2, state.attempts - 1), RESTART_MAX_MS);

        console.warn(`[ProcessManager] ${procName} for ${stream.streamId.slice(0,8)} exited unexpectedly (code ${code}). Restart #${state.attempts} in ${delay / 1000}s...`);

        if (state.timer) clearTimeout(state.timer);
        state.timer = setTimeout(() => {
            state.timer = null;
            console.log(`[ProcessManager] Auto-respawning stream ${stream.streamId.slice(0,8)}`);
            startStream(stream);
        }, delay);
    };

    if (recProc) recProc.on('exit', (code) => handleCrash('ristreceiver', code));

    const timer = setTimeout(() => {
        try {
            const sndProc = spawn(snd.cmd, snd.args, { stdio: 'pipe' });
            if (runningProcs[stream.streamId] === entry) entry.sender = sndProc;
            if (sndProc.stdout) sndProc.stdout.on('data', d => process.stdout.write(`[SND:${stream.streamId.slice(0,8)}] ${d}`));
            if (sndProc.stderr) sndProc.stderr.on('data', d => process.stderr.write(`[SND:${stream.streamId.slice(0,8)}] ${d}`));
            sndProc.on('error', () => {});
            sndProc.on('exit', (code) => handleCrash('ristsender', code));
        } catch (e) {}
    }, 2000);
    entry.timer = timer;

    console.log(`[ProcessManager] Started stream ${stream.streamId.slice(0,8)} [Recv:${stream.receivePort} -> Fwd:${stream.forwardPort}] [AES-128 enabled]`);
}

function stopStream(streamId) {
    const procs = runningProcs[streamId];
    if (!procs) return;

    procs.isShuttingDown = true; // Prevents auto-restart logic from triggering
    clearTimeout(procs.timer);
    if (procs.receiver && !procs.receiver.killed) procs.receiver.kill();
    if (procs.sender   && !procs.sender.killed)   procs.sender.kill();
    delete runningProcs[streamId];

    const state = restartState[streamId];
    if (state) {
        if (state.timer) clearTimeout(state.timer);
        state.timer = null;
        state.attempts = 0; // a deliberate stop resets the backoff
    }

    console.log(`[ProcessManager] Stopped stream ${streamId.slice(0,8)}`);
}

module.exports = { startStream, stopStream };
