'use strict';
var XbeeDigiMesh = require('./xbee-digimesh');

// connect to xbee
var xbee = new XbeeDigiMesh('/dev/ttyU1', 9600, null, function() {
    // ask for node identifier string
    xbee.get_NI_string();
});

// exit after 5 seconds
setTimeout(function() { console.log('bye'); process.exit(0); }, 5000);
