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
                    this.emit('packet_at_command_response', packet);
                    break;
                case this.FRAME_REMOTE_AT_COMMAND_RESPONSE:
                    this.emit('packet_remote_at_command_response', packet);
                    break;
                case this.FRAME_MODEM_STATUS:
                    this.emit('packet_modem_status', packet);
                    break;
                case this.FRAME_TRANSMIT_STATUS:
                    this.emit('packet_transmit_status', packet);
                    break;
                case this.FRAME_RECEIVE_PACKET:
                    this.emit('packet_receive_packet', packet);
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

XbeeDigiMesh.prototype.handle_at_command_response = function(packet) {
    // if there's an error
    if (packet[4]) {
        return this.emit('error', 'AT command error');
    }
    // if NI response
    if (packet[2] === 'N'.charCodeAt(0) && packet[3] == 'I'.charCodeAt(0)) {
        this.emit('NI_string', packet.slice(5).toString());
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

// ask the xbee for it's Node Identifer string
XbeeDigiMesh.prototype.get_NI_string = function() {
    var tx_buf = new Buffer(256);
    tx_buf[0] = this.START_BYTE;
    tx_buf[1] = 0x00;
    tx_buf[2] = 0x04;
    tx_buf[3] = this.FRAME_AT_COMMAND;
    tx_buf[4] = 0x01;
    tx_buf.write('NI', 5);
    //tx_buf[5] = 'N';
    //tx_buf[6] = 'I';
    tx_buf[7] = this.calc_checksum(tx_buf, 3, 7);
    this.write_buf(tx_buf, 8);
}


module.exports = XbeeDigiMesh;
