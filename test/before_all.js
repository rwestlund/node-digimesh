var digimesh = require('../digimesh');

// test setup
before(function(done) {
    // set defaults
    process.env.XBEE_DEVICE = process.env.XBEE_DEVICE || "/dev/ttyU0";
    process.env.XBEE_BAUD = process.env.XBEE_BAUD || 115200;

    // setup the xbee, store it in 'this' so other tests can use it
    this.xbee = new digimesh({
        device: process.env.XBEE_DEVICE,
        baud: process.env.XBEE_BAUD,
    }, done);
});
