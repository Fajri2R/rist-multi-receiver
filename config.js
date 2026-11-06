module.exports = {
    // Port ranges to allocate from
    receivePortStart: 2030,
    forwardPortStart: 5556,
    internalPortStart: 20000,
    statsPortStart: 5005,

    // RIST global settings
    ristProfile: '1', // 1 = main, 2 = advanced

    // Adaptive buffer (ms): use minimum latency on a clean link and grow
    // automatically during cellular jitter/loss.
    receiverBufferMin: '400',
    receiverBufferMax: '1800',

    reorderBuffer: '100',    // tolerate multi-SIM packet reordering (ms)
    rttMin: '30',            // expected minimum RTT, Indonesia cellular -> Singapore
    rttMax: '350',           // tolerate temporary RTT spikes
    bandwidthKbps: '15000',  // cap retransmission bursts at about 2x stream bitrate

    sessionTimeout: '8000',  // close a failed session after this many ms
    keepaliveInterval: '500' // keepalive interval in ms
};
