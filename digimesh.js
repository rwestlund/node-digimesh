'use strict';

// TODO
// need constants and strings for returning errors

// update this.md_timeout with seconds taken from NT

// when queue is full, I'm currently returning an error in the callback -- should I never call it and just return false?

// testing suite

// needed to inherit events
var EventEmitter = require('events');
var util = require('util');
// needed for serial comms
var SerialPort = require('serialport').SerialPort;

// the main class
// config:  device -- device node, eg /dev/ttyU0
//          baud -- serial baud rate
//          fire_events_and_callback -- whether to fire events when a callback was given
var XbeeDigiMesh = function(config) {
    if (typeof config !== 'object') return console.error('ERROR: config is not an oject');
    // e.g. /dev/ttyU0
    this.device = config.device;
    this.baud = config.baud;
    // normally, if a callback is passed to a function, the corresponding event will not fire to prevent double-reporting
    this.fire_events_and_callback = config.fire_events_and_callback;

    // receive buffer
    this.rx_buf = new Buffer(1024);
    this.rx_buf.fill(0);
    this.rx_buf_index = 0;
    // length of packet currently coming in, from packet length field
    this.packet_length;
    // whether we're in the process of reading a packet
    this.receiving = false;
    // last frame_id we used
    this.last_frame_id = 0;
    // dictionary mapping frame_ids to the callback we need to execute when we
    // get the ACK/NACK -- null means no callback, undefined means empty slot
    this.callback_queue = new Array(256);

    // number of milliseconds before a Network Discover will timeout (default is 13000)
    this.nd_timeout = 13000;

    // CONSTANTS
    // start delimiter
    this.START_BYTE = 0x7e;
    this.BROADCAST_ADDRESS = '000000000000ffff';
    // command types
    this.FRAME_AT_COMMAND = 0x08;
    this.FRAME_AT_COMMAND_RESPONSE = 0x88;
    this.FRAME_REMOTE_AT_COMMAND = 0x17;
    this.FRAME_REMOTE_AT_COMMAND_RESPONSE = 0x97;
    this.FRAME_MODEM_STATUS = 0x8a;
    this.FRAME_TRANSMIT_REQUEST = 0x10;
    this.FRAME_TRANSMIT_STATUS = 0x8b;
    this.FRAME_RECEIVE_PACKET = 0x90;

    this.ERR_QUEUE_FULL = 'ERR: Tx queue is full, try again later';

    // enable events
    EventEmitter.call(this);

    // open the serial port, disable flow control, don't use a buffer
    var that = this;
    this.serial_port = new SerialPort(this.device, {
        baudrate: this.baud,
        xon: false,
        xoff: false,
        xany: false,
        flowControl: false,
        bufferSize: 1,
        hupcl: false,
    }, 
    // on open event
    function(err) {
        that.emit('open');
    });

    this.serial_port.on('error', function(err) {
        that.emit('error');
    });
    this.serial_port.on('close', function() {
        that.emit('error', 'serial port closed');
    });

    // this will always receive one byte at a time, due to the SerialPort
    // bufferSize = 1
    this.serial_port.on('data', function(data) {
        that.parse_byte(data[0]);
    });
}

// copy EventEmitter properties
util.inherits(XbeeDigiMesh, EventEmitter);


////////////////////////////////////////////
// MESSAGE HANDLING FUNCTIONS
////////////////////////////////////////////

// returned upon receipt of a normal message from another unit
XbeeDigiMesh.prototype.handle_receive_packet = function(packet) {
    //console.log(packet.toString('hex').replace(/(.{2})/g, "$1 "));
    var obj = {
        // frame_id used by source
        frame_id: packet[0],
        // address of source unit
        source_addr: this.read_addr(packet, 1),
        // whether this was a broadcast or directed
        broadcast: packet[11] === 0x02,
        data: packet.slice(12, packet.length),
    }
    this.emit('message_received', obj);
}

// this is returned for each transmit with a frame_id
XbeeDigiMesh.prototype.handle_transmit_status = function(packet) {
    var data = {
        // number of retries needed
        retries: packet[4],
        // 0 = success, others are errors
        //TODO make object with code and desc fields
        delivery_status: packet[5],
        // whether the network needed to discover a new route
        discovery_needed: Boolean(packet[6]),
    };
    // find callback and call it
    this.find_callback_helper('transmit_status', packet[1], data);
}

// Modem status is emitted on boot or wake
XbeeDigiMesh.prototype.handle_modem_status = function(packet) {
    // this is an unsolicited packet, so there's no callback
    this.emit('modem_status', packet[1]);
}

// returned after sending an AT command to a remote unit
XbeeDigiMesh.prototype.handle_remote_at_command_response = function(packet) {
    // TODO implement
    console.warn('unhandled remote AT command response');
}

// returned after sending an AT command to the local unit
XbeeDigiMesh.prototype.handle_at_command_response = function(packet) {
    var frame_id = packet[1];
    var data = {};

    // if there's an error
    if (packet[4]) {
        return this.emit('error', 'AT command error');
    }
    // if NI response
    if (packet[2] === 'N'.charCodeAt(0) && packet[3] == 'I'.charCodeAt(0)) {
        // return simple NI string rather than an object
        this.find_callback_helper('NI_string', frame_id, packet.slice(5).toString());
    }
    // if ND -- discover all nodes
    else if (packet[2] === 'N'.charCodeAt(0) && packet[3] === 'D'.charCodeAt(0)) {
        //console.log(packet.toString('hex').replace(/(.{2})/g, "$1 "));
        // find index of NULL that terminates NI
        //NOTE Buffer.indexOf() needs node 4
        //var index = packet.indexOf(0x00, 13);
        var index = 15; while (packet[index]) { index++; }

        // 16-bit, 0xfffe is unknown
        data.network_addr = packet[5] << 8 | packet[6];
        data.source_addr = this.read_addr(packet, 7);
        data.ni_string = packet.slice(15, index).toString();
        // 16-bit, 0xfffe if no parent
        data.parent_net_addr = packet[index+1] << 8 | packet[index+2];
        // 0 = coordinator, 1 = router, 2 = end device
        data.device_type = packet[index+3];
        // one byte reserved for status
        data.profile_id = packet[index+5] << 8 | packet[index+6];
        data.manufacturer_id = packet[index+7] << 8 | packet[index+8];

        // as noted in the discover_nodes function, this needs special handling
        var callback = this.callback_queue[frame_id];
        // this should never happen
        if (callback === undefined) {
            this.emit('error', 'received transmit status for an invalid frame_id');
            return console.err('received transmit status for an invalid frame_id');
        }
        // if we have a valid list, append this data object
        else if (callback && typeof callback === 'object') {
            callback.push(data);
        }
        // if there's no callback, or user wants event anyway
        if (callback === null || this.fire_events_and_callback) {
            this.emit('node_discovered', data);
        }
    }
    else {
        console.warn('unhandled AT command response', packet.slice(2,4).toString());
    }
}

// Find the callback that corresponds to a particular frame_id, and call it
XbeeDigiMesh.prototype.find_callback_helper = function(event_name, frame_id, data) {
    // find callback for this frame_id
    var callback = this.callback_queue[frame_id];
    // if there's nothing there -- this should never happen
    if (callback === undefined) {
        this.emit('error', 'received transmit status for an invalid frame_id');
        return console.err('received transmit status for an invalid frame_id');
    }
    // if there's a valid callback
    else if (callback && typeof callback === 'function') {
        callback(null, data);
    }
    // if there's no callback or the user wants the event anyway
    if (callback === null || this.fire_events_and_callback) {
        // send data via event
        this.emit(event_name, data);
    }
    // finally, clear the callback and free the frame_id for reuse
    this.callback_queue[frame_id] = undefined;
    // now we know there's room or at least one more packet
    this.emit('drain');
}


////////////////////////////////////////////
// TRANSMIT FUNCTIONS
////////////////////////////////////////////

// Send a general message from this XBee
// options: data -- Buffer of exact size filled with payload
//          dest_addr -- 64-bit destination address
//          broadcast -- whether to broadcast or use the dest_addr
// callback -- callback to execute with return status
XbeeDigiMesh.prototype.send_message = function(options, callback) {
    var len = 17 + options.data.length;
    var tx_buf = new Buffer(len+4);
    // pick which address to use
    var addr = options.broadcast ? this.BROADCAST_ADDRESS : options.dest_addr;
    // get a valid frame_id or return error
    var frame_id = this.get_next_frame_id();
    if (!frame_id) return config.callback(this.ERR_QUEUE_FULL);

    tx_buf[0] = this.START_BYTE;
    tx_buf[1] = (len >> 8) & 0xff;
    tx_buf[2] = len & 0xff;
    tx_buf[3] = this.FRAME_TRANSMIT_REQUEST;
    tx_buf[4] = frame_id;
    this.write_addr(tx_buf, 5, addr);
    tx_buf[13] = 0xff;
    tx_buf[14] = 0xfe;
    tx_buf[15] = 0x00;
    tx_buf[16] = 0x00;
    options.data.copy(tx_buf, 17);
    tx_buf[tx_buf.length-1] = this.calc_checksum(tx_buf, 3, tx_buf.length-1);
    this.write_buf(tx_buf);

    // save callback or null for future use
    this.callback_queue[frame_id] = callback || null;
};

// Ask the xbee to find all nodes on the network. This needs special handling
// because it returns one message per node (all with the same frame_id).
// Rather than callback after the first message, we callback after the timeout
// value. In place of the callback, we store the list of responses on the
// callback queue.
XbeeDigiMesh.prototype.discover_nodes = function(callback) {
    // store an empty list rather than the callback
    var frame_id = this.at_command_helper('ND', []);
    // if it didn't get send, get out
    if (!frame_id) return;

    // callback after this.nd_timeout ms
    var that = this;
    setTimeout(function() {
        // deliver whatever nodes we've discovered
        callback(null, that.callback_queue[frame_id]);
        // clear frame_id
        that.callback_queue[frame_id] = undefined;
    },
    this.nd_timeout);
}
// Ask the xbee for it's Node Identifer string
XbeeDigiMesh.prototype.get_NI_string = function(callback) {
    this.at_command_helper('NI', callback);
}

// Helper function to build packets for AT commands
XbeeDigiMesh.prototype.at_command_helper = function(command, callback) {
    // get a valid frame_id or return error
    var frame_id = this.get_next_frame_id();
    if (!frame_id) return callback(this.ERR_QUEUE_FULL);

    // build and send packet
    var tx_buf = new Buffer(8);
    tx_buf[0] = this.START_BYTE;
    tx_buf[1] = 0x00;
    tx_buf[2] = 0x04;
    tx_buf[3] = this.FRAME_AT_COMMAND;
    tx_buf[4] = frame_id;
    tx_buf.write(command, 5);
    tx_buf[7] = this.calc_checksum(tx_buf, 3, tx_buf.length-1);
    this.write_buf(tx_buf);

    // save callback or null for future use
    this.callback_queue[frame_id] = callback || null;
    return frame_id;
}


////////////////////////////////////////////
// UTILITY FUNCTIONS
////////////////////////////////////////////

// receive a new byte and add it to the incoming packet buffer
XbeeDigiMesh.prototype.parse_byte = function(c) {
    // if we're starting a new packet
    if (!this.receiving) {
        if (c === this.START_BYTE) {
            //console.log('start of packet');
            this.rx_buf[this.rx_buf_index++] = c;
            this.receiving = true;
        }
        else console.warn('discarding byte');
        return;
    }
    // if we're receiving the length
    if (this.receiving && this.rx_buf_index < 3) {
        this.rx_buf[this.rx_buf_index++] = c;
        // we have the length
        if (this.rx_buf_index === 3) {
            // add 4 bytes for start, length, and checksum
            this.packet_length = (this.rx_buf[1]<<8 |this.rx_buf[2]) + 4;
            //console.log('incoming packet total length:', this.packet_length);
        }
        return;
    }
    // finish out rest of packet
    this.rx_buf[this.rx_buf_index++] = c;
    // if we're done receiving bytes
    if (this.rx_buf_index === this.packet_length) {


        // if the checksum matches
        if (this.rx_buf[this.rx_buf_index-1] ===
            this.calc_checksum(this.rx_buf, 3, this.packet_length-1)) {
            //console.log('full packet received');

            // copy data to new buffer so this one can be reused
            var packet = new Buffer(this.rx_buf.slice(3, this.packet_length-1));

            //TODO should I emit raw packets, or parse it out into json?
            switch (packet[0]) {
                case this.FRAME_AT_COMMAND_RESPONSE:
                    this.handle_at_command_response(packet);
                    //this.emit('packet_at_command_response', packet);
                    break;
                case this.FRAME_REMOTE_AT_COMMAND_RESPONSE:
                    this.handle_remote_at_command_response(packet);
                    //this.emit('packet_remote_at_command_response', packet);
                    break;
                case this.FRAME_MODEM_STATUS:
                    this.handle_modem_status(packet);
                    //this.emit('packet_modem_status', packet);
                    break;
                case this.FRAME_TRANSMIT_STATUS:
                    this.handle_transmit_status(packet);
                    //this.emit('packet_transmit_status', packet);
                    break;
                case this.FRAME_RECEIVE_PACKET:
                    this.handle_receive_packet(packet);
                    //this.emit('packet_receive_packet', packet);
                    break;
                default:
                    this.emit('error', 'unknown packet type received: ' + this.packet[0]);
            }
        }
        else {
            console.error('malformed packet');
        }
        // get ready for next packet
        this.receiving = false;
        this.rx_buf_index = 0;
    }
}


// take a buffer and calculate the checksum
XbeeDigiMesh.prototype.calc_checksum = function(buf, start, end) {
    var sum = 0;
    for (var i = start; i < end; i++) {
        sum += buf[i];
    }
    return (0xff - sum) & 0xff;
}

// take a buffer and write it to the serial port
XbeeDigiMesh.prototype.write_buf = function(buf) {
    var that = this;
    // make sure nothing is using the serial port
    this.serial_port.drain(function() {
            
        // print the buffer // DEBUG
        // TODO why does this have to be 'hex', but others need 16?
        //console.log(buf.toString('hex').replace(/(.{2})/g, "$1 "));

        // write the tx buffer
        that.serial_port.write(buf, function(err, result) {
            if (err) {
                that.emit('error', err);
            }
            //console.log('packet sent');
        });
    });
}

// This is genuinely stupid. JavaScript can only do doubles, and 2^53 can't hold
// a 64-bit address. We have to do all large numbers as strings.

// read a 64-bit address out of a buffer at an index, returning a hex string
XbeeDigiMesh.prototype.read_addr = function(buf, index) {
    var addr = '';
    for (var i = index; i < index + 8; i++) {
        // Also stupid. JavaScript can't format numbers, so I have to add the
        // leading zero manually, then slice the last two characters off
        addr += ('0' + buf[i].toString(16)).slice(-2);
    }
    return addr;
}

// write a 64-bit address hex string into a buffer at an index
XbeeDigiMesh.prototype.write_addr = function(buf, index, addr) {
    for (var i = 0; i < 8; i++) {
        buf[index+i] = parseInt(addr.slice(2*i, 2*i+2), 16);
    }
    return addr;
}

// Look at last frame_id we used and return the next one, rolling over.
// Values range from 1 to 255, inclusive
XbeeDigiMesh.prototype.get_next_frame_id = function() {
    this.last_frame_id++;
    if (this.last_frame_id > 255) this.last_frame_id = 1;
    return this.last_frame_id;
    // TODO check whether it's being used
}


module.exports = XbeeDigiMesh;
