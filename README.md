# node-digimesh

This is a node module that implements the XBee Digimesh protocol.

## Dependencies
- [serialport](https://github.com/voodootikigod/node-serialport)

## Description

The goal is to wrap the DigiMesh protocol with a simple callback
interface that doesn't require a user to worry about frame\_id numbers
or binary buffers.  The serialport library provides the serial
communication.

This library provides a callback API by maintaining an internal callback
queue with callbacks for each unacknowledged message.  The application
provides a callback for each sent message.  When the AT command response
or message ACK is received, that callback is looked up from the queue
and invoked.  This makes it possible to use DigiMesh XBees without
caring much about the underlying protocol.

There is also an event that is fired for each new message or response.
By default, the event does not fire when a callback has been provided.


**Note:** The XBees must be in API mode (AP=1).

## License

This library is under the BSD-2-Clause license.

## Installation
```
npm install digimesh
```

## Testing

Testing is done with `mocha`, `chai`, and `sinon`.  Set the environment
variables `XBEE_DEVICE` and `XBEE_BAUD`, then run `mocha`.  You must
have at least one other XBee on the network to bounce messages off of.

## Usage

You'll have to RTFS and play with it to get everything, but here are
some examples.

### Initialization
```
var Xbee = require('./digimesh');

var xbee = new Xbee({ device: '/dev/ttyU0', baud: 115200 }, function() {
    console.log('xbee is ready');
    // do stuff
});
```
The configuration object contains the following options:
- `device` A serial device node on your machine
- `baud` The serial baud rate of the device
- `always_fire_event` Whether to fire message events even when a callback was provided

The `device` and `baud` parameters are passed directly to the serialport
library.

### AT commands
A handful of AT commands are supported, with more being added.  Most of
them require special handling, so there isn't a general 'send AT
command' function.

```
// ask for node identifier string
xbee.get_ni_string(function(err, data) {
    if (err) return console.err(err);
    console.log("my NI is '" + data.ni + "'");
});

// set node identifier string
xbee.set_ni_string('my_xbee_name', function(err, data) {
    if (err) return console.err(err);

    // print the human-friendly version
    console.log(xbee.AT_COMMAND_RESPONSE_STATUS_STRINGS[data.status]);

    // check based on the constants
    if (data.status === xbee.AT_COMMAND_RESPONSE_STATUS_OK)
        console.log('it worked');
    else {
        // do something
    }
});
```
### Discovering Nodes
```
// find all nodes on the network
xbee.discover_nodes(function(err, nodes) {
    if (err) return console.err(err);

    console.log('%d nodes found:', nodes.length);
    console.dir(nodes);
});
```

### Message Handling
```
xbee.on('message_received', function(data) {
    console.log('received a message from %s!', data.addr);
    console.dir(data);

    // don't be rude, say hello!
    xbee.send_message({
        data: new Buffer("hello"),
        addr: data.addr,
        broadcast: false,
    },
    // callback
    function(err, data) {
        if (err) return console.error(err);

        // print the string status message for the status we got back
        console.log('delivery status: %s',
            xbee.DELIVERY_STATUS_STRINGS[data.status]);

        // print the response object
        console.dir(data);
        console.log('goodbye');
    })
});
```

