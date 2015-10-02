'use strict';

var EventEmitter = require('events');
var util = require('util');
var SerialPort = require('serialport').SerialPort;

// the main class
var XbeeDigiMesh = function(device, baud) {
    // e.g. /dev/ttyU0
    this.device = device;
    this.baud = baud;

    // receive buffer
    this.rx_buf = new Buffer(256);
    this.rx_buf.fill(0);
    this.rx_buf_index = 0;
    // length of packet currently coming in, from packet length field
    this.packet_length;
    // whether we're in the process of reading a packet
    this.receiving = false;

    // CONSTANTS
    // start delimiter
    this.START_BYTE = 0x7e;
    // command types
    this.FRAME_AT_COMMAND = 0x08;
    this.FRAME_AT_COMMAND_RESPONSE = 0x88;
    this.FRAME_REMOTE_AT_COMMAND = 0x17;
    this.FRAME_REMOTE_AT_COMMAND_RESPONSE = 0x97;
    this.FRAME_MODEM_STATUS = 0x8a;
    this.FRAME_TRANSMIT_REQUEST = 0x10;
    this.FRAME_TRANSMIT_STATUS = 0x8b;
    this.FRAME_RECEIVE_PACKET = 0x90;

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
        // print the byte
        //console.log(data.toString('hex'));
        var c = data[0];
        that.parse_byte(c);
    });
}

// copy EventEmitter properties
util.inherits(XbeeDigiMesh, EventEmitter);


////////////////////////////////////////////
// MESSAGE HANDLING FUNCTIONS
////////////////////////////////////////////

// returned upon receipt of a normal message from another unit
XbeeDigiMesh.prototype.handle_receive_packet = function(packet) {
    var obj = {
        // frame_id used by source
        frame_id: packet[0],
        // address of source unit
        source_addr: packet[1] << 56 |
                     packet[2] << 48 |
                     packet[3] << 40 |
                     packet[4] << 32 |
                     packet[5] << 24 |
                     packet[6] << 16 |
                     packet[7] << 8 |
                     packet[8],
        // whether this was a broadcast or directed
        broadcast: packet[11] === 0x02,
        // actual payload
        data: packet.slice(12, packet.length),
    }

}

// this is returned for each transmit with a frame_id
XbeeDigiMesh.prototype.handle_transmit_status = function(packet) {
    var obj = {
        // id used when sending packet (if not zero)
        frame_id: packet[1],
        // number of retries needed
        retries: packet[4],
        // 0 = success, others are errors
        delivery_status: packet[5],
        // whether the network needed to discover a new route
        discovery_needed: Boolean(packet[6]),
    };
    this.emit('transmit_status', obj);
}

// emitted on boot or wake
XbeeDigiMesh.prototype.handle_modem_status = function(packet) {
    this.emit('modem_status', packet[1]);
}

// returned after sending an AT command to a remote unit
XbeeDigiMesh.prototype.handle_remote_at_command_response = function(packet) {
    console.warn('unhandled remote AT command response');
}

// returned after sending an AT command to the local unit
XbeeDigiMesh.prototype.handle_at_command_response = function(packet) {
    // if there's an error
    if (packet[4]) {
        return this.emit('error', 'AT command error');
    }
    // if NI response
    if (packet[2] === 'N'.charCodeAt(0) && packet[3] == 'I'.charCodeAt(0)) {
        this.emit('NI_string', packet.slice(5).toString());
    }
    else {
        console.warn('unhandled AT command response');
    }
}

////////////////////////////////////////////
// TRANSMIT FUNCTIONS
////////////////////////////////////////////

// send a general message from this XBee
// options: data -- Buffer of exact size filled with payload
//          frame_id -- frame_id to use
//          dest_addr -- 64-bit destination address
//          broadcast -- whether to broadcast or use the dest_addr
XbeeDigiMesh.prototype.send_message = function(options) {
    var tx_buf = new Buffer(256);
    var len = 18 + options.data.length;

    // pick which address to use
    var addr = options.broadcast ? this.BROADCAST_ADDRESS : options.dest_addr;

    tx_buf[0] = this.START_BYTE;
    tx_buf[1] = (len >> 8) & 0xff;
    tx_buf[2] = len & 0xff;
    tx_buf[3] = this.FRAME_TRANSMIT_REQUEST;
    tx_buf[4] = options.frame_id
    tx_buf[5] = (addr >> 56) & 0xff;
    tx_buf[6] = (addr >> 48) & 0xff;
    tx_buf[7] = (addr >> 40) & 0xff;
    tx_buf[8] = (addr >> 32) & 0xff;
    tx_buf[9] = (addr >> 24) & 0xff;
    tx_buf[10] = (addr >> 16) & 0xff;
    tx_buf[11] = (addr >> 8) & 0xff;
    tx_buf[12] = addr & 0xff;
    tx_buf[13] = 0xff;
    tx_buf[14] = 0xfe;
    tx_buf[15] = 0x00;
    tx_buf[16] = 0x00;
    options.data.copy(tx_buf, 17);
    tx_buf[len-1] = this.calc_checksum(tx_buf, 3, len-1);
    this.write_buf(tx_buf, len);
};

// ask the xbee for it's Node Identifer string
// options: frame_id -- frame_id to use
XbeeDigiMesh.prototype.discover_nodes = function(options) {
    var tx_buf = new Buffer(256);
    tx_buf[0] = this.START_BYTE;
    tx_buf[1] = 0x00;
    tx_buf[2] = 0x04;
    tx_buf[3] = this.FRAME_AT_COMMAND;
    tx_buf[4] = options.frame_id.
    tx_buf.write('ND', 5);
    tx_buf[7] = this.calc_checksum(tx_buf, 3, 7);
    this.write_buf(tx_buf, 8);
}

// ask the xbee for it's Node Identifer string
// options: frame_id -- frame_id to use
XbeeDigiMesh.prototype.get_NI_string = function(options) {
    var tx_buf = new Buffer(256);
    tx_buf[0] = this.START_BYTE;
    tx_buf[1] = 0x00;
    tx_buf[2] = 0x04;
    tx_buf[3] = this.FRAME_AT_COMMAND;
    tx_buf[4] = options.frame_id.
    tx_buf.write('NI', 5);
    tx_buf[7] = this.calc_checksum(tx_buf, 3, 7);
    this.write_buf(tx_buf, 8);
}


////////////////////////////////////////////
// UTILITY FUNCTIONS
////////////////////////////////////////////

// receive a new byte and add it to the incoming packet buffer
XbeeDigiMesh.prototype.parse_byte = function(c) {
    // if we're starting a new packet
    if (!this.receiving) {
        if (c === this.START_BYTE) {
            console.log('start of packet');
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
            console.log('full packet received');

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
XbeeDigiMesh.prototype.write_buf = function(buf, length) {
    var that = this;
    // make sure nothing is using the serial port
    this.serial_port.drain(function() {
            
        // print the buffer
        console.log(buf.slice(0, length).toString('hex').replace(/(.{2})/g, "$1 "));

        // write the proper slice of the tx buffer
        that.serial_port.write(buf.slice(0, length), function(err, result) {
            if (err) {
                that.emit('error', err);
            }
            console.log('packet sent');
        });
    });
}


module.exports = XbeeDigiMesh;
