'use strict';
var XbeeDigiMesh = require('./xbee-digimesh');

// connect to xbee
var xbee = new XbeeDigiMesh('/dev/ttyU0', 9600);

xbee.on('open', function() {
    console.log('looks like xbee is ready');

    // ask for node identifier string
    xbee.get_NI_string();
    xbee.discover_nodes();
});

xbee.on('error', function(err) {
    console.error(err);
    process.exit(1);
});

xbee.on('NI_string', function(ni) {
    console.log("my NI is '", ni, "'");
});
