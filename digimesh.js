// Copyright (c) 2015 Randy Westlund, All rights reserved.
// This code is under the BSD-2-Clause license.

'use strict';
// needed to inherit events
var EventEmitter = require('events');
var util = require('util');
// needed for serial comms
var SerialPort = require('serialport').SerialPort;

// the main class
// config:  device -- device node, eg /dev/ttyU0
//          baud -- serial baud rate
//          always_fire_event -- whether to fire events when a callback was given
// callback: optional callback to exexute on the 'open' event
var XbeeDigiMesh = function(config, callback) {
    if (typeof config !== 'object') return console.error('ERROR: config is not an oject');
    // e.g. /dev/ttyU0
    this.device = config.device;
    this.baud = config.baud;
    // normally, if a callback is passed to a function, the corresponding event
    // will not fire to prevent double-reporting
    this.always_fire_event = config.always_fire_event;

    // receive buffer
    this.rx_buf = new Buffer(1024);
    this.rx_buf.fill(0);
    this.rx_buf_index = 0;
    // length of packet currently coming in, from packet length field
    this.packet_length;
    // whether we're in the process of reading a packet
    this.receiving = false;
    // last frame_id we used
    this.frame_id = 0;
    // dictionary mapping frame_ids to the callback we need to execute when we
    // get the ACK/NACK -- null means no callback, undefined means empty slot
    this.callback_queue = new Array(256);

    // number of milliseconds before a Network Discover will timeout (default is 13000)
    this.nt_timeout = 13000;

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

    // delivery status for transmit_status messages
    this.DELIVERY_STATUS_SUCCESS = 0x00;
    this.DELIVERY_STATUS_MAC_ACK_FAILURE = 0x01;
    this.DELIVERY_STATUS_INVALID_ADDR = 0x15;
    this.DELIVERY_STATUS_NETWORK_ACK_FAILURE = 0x21;
    this.DELIVERY_STATUS_ROUTE_NOT_FOUND = 0x25;
    this.DELIVERY_STATUS_STRINGS = {};
    this.DELIVERY_STATUS_STRINGS[this.DELIVERY_STATUS_SUCCESS]
        = 'success',
    this.DELIVERY_STATUS_STRINGS[this.DELIVERY_STATUS_MAC_ACK_FAILURE]
        = 'MAC ACK failure',
    this.DELIVERY_STATUS_STRINGS[this.DELIVERY_STATUS_INVALID_ADDR]
        = 'invalid addess',
    this.DELIVERY_STATUS_STRINGS[this.DELIVERY_STATUS_NETWORK_ACK_FAILURE]
        = 'network ACK failure',
    this.DELIVERY_STATUS_STRINGS[this.DELIVERY_STATUS_ROUTE_NOT_FOUND]
        = 'route not found',

    // modem_status fields
    this.MODEM_STATUS_HARDWARE_RESET = 0x00;
    this.MODEM_STATUS_WATCHDOG_RESET = 0x01;
    this.MODEM_STATUS_NETWORK_WAKE = 0x0b;
    this.MODEM_STATUS_NETWORK_SLEEP = 0x0c;
    this.MODEM_STATUS_STRINGS = {};
    this.MODEM_STATUS_STRINGS[this.MODEM_STATUS_HARDWARE_RESET]
        = 'hardware reset',
    this.MODEM_STATUS_STRINGS[this.MODEM_STATUS_WATCHDOG_RESET]
        = 'watchdog reset',
    this.MODEM_STATUS_STRINGS[this.MODEM_STATUS_NETWORK_WAKE]
        = 'network wake',
    this.MODEM_STATUS_STRINGS[this.MODEM_STATUS_NETWORK_SLEEP]
        = 'network sleep',

    // AT command response status
    this.AT_COMMAND_RESPONSE_STATUS_OK = 0x00;
    this.AT_COMMAND_RESPONSE_STATUS_ERR = 0x01;
    this.AT_COMMAND_RESPONSE_STATUS_INVALID_COMMAND = 0x02;
    this.AT_COMMAND_RESPONSE_STATUS_INVALID_PARAM = 0x03;
    this.AT_COMMAND_RESPONSE_STATUS_STRINGS = {};
    this.AT_COMMAND_RESPONSE_STATUS_STRINGS[this.AT_COMMAND_RESPONSE_STATUS_OK]
        = 'success',
    this.AT_COMMAND_RESPONSE_STATUS_STRINGS[this.AT_COMMAND_RESPONSE_STATUS_ERR]
        = 'error',
    this.AT_COMMAND_RESPONSE_STATUS_STRINGS[
        this.AT_COMMAND_RESPONSE_STATUS_INVALID_COMMAND] = 'invalid command',
    this.AT_COMMAND_RESPONSE_STATUS_STRINGS[
        this.AT_COMMAND_RESPONSE_STATUS_INVALID_PARAM] = 'invalid parameter',

    // enable events
    EventEmitter.call(this);

    // open the serial port, disable flow control, don't use a buffer
    var that = this;
    this.serial_port = new SerialPort(this.device, {
        baudrate: this.baud,
        xon: false,
        xoff: false,
        xany: false,
        flowControl: true,
        rtscts: true,
        bufferSize: 1,
        hupcl: false,
    }, 
    // on open event
    function(err) {
        // update our NT value, drop the return status
        that.get_nt(function(err, data) {
            // pass err to callback
            if (callback && typeof callback === 'function') callback(err);
            that.emit('open', err);
        });
    });

    this.serial_port.on('error', function(err) {
        console.error(error);
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
    return this;
};

// copy EventEmitter properties
util.inherits(XbeeDigiMesh, EventEmitter);


////////////////////////////////////////////
// MESSAGE HANDLING FUNCTIONS
////////////////////////////////////////////

// returned upon receipt of a normal message from another unit
XbeeDigiMesh.prototype.handle_receive_packet = function(packet) {
    //console.log(packet.toString('hex').replace(/(.{2})/g, "$1 "));
    var data = {
        // frame_id used by source
        frame_id: packet[1],
        // address of source unit
        addr: this.read_addr(packet, 2),
        // whether this was a broadcast or directed
        broadcast: packet[11] === 0x02,
        data: packet.slice(12, packet.length),
    }
    this.emit('message_received', data);
};

// this is returned for each transmit with a frame_id
XbeeDigiMesh.prototype.handle_transmit_status = function(packet) {
    var data = {
        // number of retries needed
        retries: packet[4],
        // 0 = success, others are errors
        status: packet[5],
        // whether the network needed to discover a new route
        discovery_needed: Boolean(packet[6]),
    };
    // find callback and call it
    this.find_callback_helper('transmit_status', packet[1], data);
};

// Modem status is emitted on boot or wake
XbeeDigiMesh.prototype.handle_modem_status = function(packet) {
    // this is an unsolicited packet, so there's no callback
    this.emit('modem_status', packet[1]);
};

// returned after sending an AT command to a remote unit
XbeeDigiMesh.prototype.handle_remote_at_command_response = function(packet) {
    // TODO implement
    console.warn('unhandled remote AT command response');
};

// returned after sending an AT command to the local unit
XbeeDigiMesh.prototype.handle_at_command_response = function(packet) {
    var frame_id = packet[1];
    var data = {};

    // if there's an error
    if (packet[4]) {
        return this.emit('error', 'AT command error');
    }
    // if NI response
    if (packet.toString(undefined, 2,4) === 'NI') {
        data.ni = packet.slice(5).toString();
        data.status = packet[4];
        this.find_callback_helper('ni_string', frame_id, data);
    }
    else if (packet.toString(undefined, 2,4) === 'NT') {
        data.status = packet[4];
        // timeout in ms -- this is two bytes, but can't be over 0xFC
        data.timeout = packet[6] * 100;
        if (data.status === this.AT_COMMAND_RESPONSE_STATUS_OK)
            this.nt_timeout = data.timeout;
        this.find_callback_helper('nt_timeout', frame_id, data);
    }
    // if ND -- discover all nodes
    else if (packet.toString(undefined, 2,4) === 'ND') {
        //console.log(packet.toString('hex').replace(/(.{2})/g, "$1 "));
        // find index of NULL that terminates NI
        //NOTE Buffer.indexOf() needs node 4, use loop until upgrade
        //var index = packet.indexOf(0x00, 13);
        var index = 15; while (packet[index]) { index++; }

        // 16-bit, 0xfffe is unknown
        data.network_addr = packet[5] << 8 | packet[6];
        data.addr = this.read_addr(packet, 7);
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
            console.error(packet.toString('hex').replace(/(.{2})/g, "$1 "));
            console.error('received transmit status for an invalid frame_id');
            return this.emit('error', 'received transmit status for an invalid frame_id');
        }
        // if we have a valid list, append this data object
        else if (callback && typeof callback === 'object') {
            callback.push(data);
        }
        // if there's no callback, or user wants event anyway
        if (callback === null || this.always_fire_event) {
            this.emit('node_discovered', data);
        }
    }
    else {
        console.warn('unhandled AT command response', packet.slice(2,4).toString());
    }
};

// Find the callback that corresponds to a particular frame_id, and call it
XbeeDigiMesh.prototype.find_callback_helper = function(event_name, frame_id, data) {
    // find callback for this frame_id
    var callback = this.callback_queue[frame_id];

    // free the frame_id for reuse, *before* we callback -- otherwise a callback
    // that sends a message may fail unnecessarily
    this.free_frame_id(frame_id);

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
    if (callback === null || this.always_fire_event) {
        // send data via event
        this.emit(event_name, data);
    }
    // now we know there's room or at least one more packet
    this.emit('drain');
};


////////////////////////////////////////////
// TRANSMIT FUNCTIONS
////////////////////////////////////////////

// Send a general message from this XBee
// options: data -- Buffer of exact size filled with payload
//          addr -- 64-bit destination address
//          broadcast -- whether to broadcast or use the addr
// callback -- callback to execute with return status
XbeeDigiMesh.prototype.send_message = function(options, callback) {
    var len = 17 + options.data.length;
    var tx_buf = new Buffer(len+4);
    // pick which address to use
    var addr = options.broadcast ? this.BROADCAST_ADDRESS : options.addr;
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

    var that = this;
    // if there's a callback
    if (callback && typeof callback === 'function') {
        // after nt_timeout ms
        setTimeout(function() {
            // pass all our discovered nodes to callback
            callback(null, that.callback_queue[frame_id]);
            // clear frame_id
            this.free_frame_id(frame_id);
        },
        // add 1 second as fudge factor
        this.nt_timeout + 1000);
    }
    // if no callback
    else {
        // reserve the frame_id for the timeout duration so node_discovered events will fire
        this.callback_queue[frame_id] = null;
        setTimeout(function() { that.free_frame_id(frame_id); }, this.nt_timeout);
    }
};
// Ask the xbee for it's Node Identifer string
XbeeDigiMesh.prototype.get_ni_string = function(callback) {
    this.at_command_helper('NI', callback);
};
// Set the xbee's Node Identifier string
XbeeDigiMesh.prototype.set_ni_string = function(ni, callback) {
    this.at_command_helper('NI', callback, new Buffer(ni));
};
// Get the Network discover Timeout
XbeeDigiMesh.prototype.get_nt = function(callback) {
    this.at_command_helper('NT', callback);
};


// Helper function to build packets for AT commands
// command:     AT command string
// callback:    callback function to queue up
// data:        optional command parameter Buffer
XbeeDigiMesh.prototype.at_command_helper = function(command, callback, data) {
    // get a valid frame_id or return error
    var frame_id = this.get_next_frame_id();
    if (!frame_id) return callback(this.ERR_QUEUE_FULL);
    // length of parameter value
    var param_len = data ? data.length : 0;

    // build and send packet
    var tx_buf = new Buffer(8 + param_len);
    tx_buf[0] = this.START_BYTE;
    tx_buf[1] = param_len >> 8;
    tx_buf[2] = (0x04 + param_len) & 0xff;
    tx_buf[3] = this.FRAME_AT_COMMAND;
    tx_buf[4] = frame_id;
    tx_buf.write(command, 5);
    // if we have a parameter, copy it over
    if (data) data.copy(tx_buf, 7)
    tx_buf[7 + param_len] = this.calc_checksum(tx_buf, 3, tx_buf.length-1);
    //console.log(tx_buf.toString('hex').replace(/(.{2})/g, "$1 "));
    this.write_buf(tx_buf);

    // save callback or null for future use
    this.callback_queue[frame_id] = callback || null;
    return frame_id;
};


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
        else console.warn('discarding byte', c.toString(16));
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
};


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
        });
    });
};

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
};

// write a 64-bit address hex string into a buffer at an index
XbeeDigiMesh.prototype.write_addr = function(buf, index, addr) {
    for (var i = 0; i < 8; i++) {
        buf[index+i] = parseInt(addr.slice(2*i, 2*i+2), 16);
    }
    return addr;
};

// Look at last frame_id we used and return the next one, rolling over.
// Values range from 1 to 255, inclusive
XbeeDigiMesh.prototype.get_next_frame_id = function() {
    // save last id
    var prev = this.frame_id;
    // advance until we find an empty slot
    do {
        this.frame_id++;
        // wrap at 8 bits, skipping 0
        if (this.frame_id > 255) this.frame_id = 1;
        // if we've gone all the way around, then we can't send
        if (this.frame_id === prev) return;
    }
    while (this.callback_queue[this.frame_id] !== undefined);
    // return valid frame_id for next packet
    return this.frame_id;
};

// free a particular frame_id so it can be reused
XbeeDigiMesh.prototype.free_frame_id = function(frame_id) {
    this.callback_queue[frame_id] = undefined;
};


module.exports = XbeeDigiMesh;
