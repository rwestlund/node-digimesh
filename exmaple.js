'use strict';
var XbeeDigiMesh = require('./digimesh');

// connect to xbee
var xbee = new XbeeDigiMesh({ device: '/dev/ttyU0', baud: 9600 });

xbee.on('open', function() {
    console.log('looks like xbee is ready');

    xbee.set_ni_string('sdlfk', function(err, result) {
        if (err) return console.err(err);
        console.log('result:');
        console.dir(result);

        // ask for node identifier string
        xbee.get_ni_string(function(err, data) {
            if (err) return console.err(err);
            console.log("my NI is '" + data.ni + "'");
        });
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

xbee.on('ni_string', function(ni) {
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
