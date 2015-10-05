'use strict';
var XbeeDigiMesh = require('./digimesh');

// connect to xbee
var xbee = new XbeeDigiMesh({ device: '/dev/ttyU0', baud: 9600 });

xbee.on('open', function() {
    console.log('looks like xbee is ready');

    // ask for node identifier string
    xbee.get_NI_string(function(err, ni) {
        if (err) return console.err(err);
        console.log("my NI is '" + ni + "'");
    });

    console.log('looking for nodes...');
    xbee.discover_nodes(function(err, data) {
        if (err) return console.err(err);
        console.dir(data);

        xbee.send_message({
            data: new Buffer("hello"),
            dest_addr: data[0].source_addr,
            broadcast: false,
        },
        // callback
        function(err, data) {
            if (err) return console.error(err);
            console.dir(data);
        });

    });
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
    });
});

xbee.on('message_received', function(data) {
    console.dir(data);
});

xbee.on('transmit_status', function(data) {
    console.dir(data);
});
