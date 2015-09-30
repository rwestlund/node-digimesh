'use strict';

var SerialPort = require('serialport').SerialPort;

// the main class
var XbeeDigiMesh = function(device, baud, data_callback, ready_callback) {
    // e.g. /dev/ttyU0
    this.device = device;
    this.baud = baud;
    // call this when we have a full packet maybe?
    this.data_callback = data_callback;

    // receive buffer
    this.rx_buf = new Buffer(256);
    this.rx_buf.fill(0);
    this.rx_buf_index = 0;
    // length of packet currently coming in
    this.packet_length;
    // whether we're in the process of reading a packet
    this.receiving = false;
    // start delimiter
    this.START_BYTE = 0x7e;
    // command types
    this.FRAME_AT_COMMAND = 0x08;

    // open the serial port, disable flow control, don't use a buffer
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
        if (err) {
            console.error(err);
            process.exit(1);
        }
        console.log('serial port opened:', device, '@', baud);
        ready_callback();
    });

    this.serial_port.on('error', function(err) {
        console.error(err);
        process.exit(1);
    });
    this.serial_port.on('close', function() {
        console.warn('serial port closed');
        process.exit(1);
    });

    // this will always receive one byte at a time, due to the SerialPort
    // bufferSize = 1
    var that = this;
    this.serial_port.on('data', function(data) {
        // print the byte
        //console.log(data.toString('hex'));
        var c = data[0];
        that.parse_byte(c);

    });
}

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
            //TODO handle packet types
        }
        else {
            console.error('malformed packet');
        }
        // ready for next packet
        this.receiving = false;
        this.rx_buf_index = 0;
    }
}

// take a tx buffer and insert the checksum
XbeeDigiMesh.prototype.calc_checksum = function(buf, start, end) {
    var sum = 0;
    for (var i = start; i < end; i++) {
        sum += buf[i];
    }
    return (0xff - sum) & 0xff;
}

// take a buffer and write it to the serial port
XbeeDigiMesh.prototype.write_buf = function(buf, length) {
    // save the reference because we can't access 'this' through closure
    var serial = this.serial_port;
    // make sure nothing is using the serial port
    this.serial_port.drain(function() {
            
        // print the buffer
        console.log(buf.slice(0, length).toString('hex').replace(/(.{2})/g, "$1 "));

        // write the proper slice of the tx buffer
        serial.write(buf.slice(0, length), function(err, result) {
            if (err) {
                console.error(err);
                process.exit(1);
            }
            console.log('packet sent');
            console.log(result);
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
    tx_buf[5] = 'N';
    tx_buf[6] = 'I';
    tx_buf[7] = this.calc_checksum(tx_buf, 3, 7);
    this.write_buf(tx_buf, 8);
}



module.exports = XbeeDigiMesh;
