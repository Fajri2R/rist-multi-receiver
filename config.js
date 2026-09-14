module.exports = {
    // Port ranges to allocate from
    receivePortStart: 2030,
    forwardPortStart: 5556,
    internalPortStart: 20000,
    statsPortStart: 5005,
    
    // RIST global settings
    ristProfile: '1', // 1 = main, 2 = advanced
    receiverBuffer: '1800',
    rttMin: '70',
    rttMax: '1200'
};

