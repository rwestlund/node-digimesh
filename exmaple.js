'use strict';
var XbeeDigiMesh = require('./xbee-digimesh');

// connect to xbee
var xbee = new XbeeDigiMesh('/dev/ttyU0', 9600);

xbee.on('open', function() {
    console.log('looks like xbee is ready');

    // ask for node identifier string
    xbee.get_NI_string({ frame_id: 1 });
    xbee.discover_nodes({ frame_id:2 });
});

xbee.on('error', function(err) {
    console.error(err);
    process.exit(1);
});

xbee.on('NI_string', function(ni) {
    console.log("my NI is '", ni, "'");
});

xbee.on('node_discovered', function(data) {
    console.dir(data);
    console.log('saying hello to', data.source_addr);

    xbee.send_message({
        data: new Buffer("hello"),
        dest_addr: data.source_addr,
        broadcast: false,
        frame_id: 4,
    });
});

xbee.on('message_received', function(data) {
    console.dir(data);
});

xbee.on('transmit_status', function(data) {
    console.dir(data);
});
