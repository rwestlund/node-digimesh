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
        buffersize: 0,
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

    this.serial_port.on('data', function(data) {
        console.log('length of data:', data.length);
        var c = data[0];
        // if we're starting a new packet
        if (!receiving) {
            if (c == START_BYTE) {
                rx_buf[rx_buf_index++] = c;
                receiving = true;
            }
            return;
        }
        // if we're receiving the length
        if (receiving && rx_buff_index < 3) {
            rx_buf[rx_buf_index++] = c;
            // we have the length
            if (rx_buf_index == 3) {
                // add 4 bytes for start, length, and checksum
                packet_length = (rx_buf[1]<<8 |rx_buf[2]) + 4;
            }
            return;
        }
        // finish out rest of packet
        rx_buf[rx_buf_index++] = c;
        // if we're done
        if (rx_buf_index == packet_length) {
            if (this.verify_checksum()) {
                console.log('full packet received');
            }
            else {
                console.error('malformed packet');
            }
        }

    });
}

// look at rx_buf and decide whether packet is valid
XbeeDigiMesh.prototype.verify_checksum = function() {
    var sum = 0;
    for (var i = 3; i < this.packet_length; i++) {
        sum += this.rx_buf[i];
    }
    return (sum | 0xff) == 0;
}

// take a tx buffer and insert the checksum
XbeeDigiMesh.prototype.calc_checksum = function(buf, start, end) {
    var sum = 0;
    for (var i = start; i < end; i++) {
        sum += buf[i];
    }
    return sum & 0xff;
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
