// Copyright (c) 2015 Randy Westlund, All rights reserved.
// This code is under the BSD-2-Clause license.

'use strict';
var expect = require('chai').expect;
var async = require('async');

// Testing with a heavy load
describe("Heavy Load", function() {
    describe("AT command flood", function() {
        it("should handle 255 AT commands", function(done) {
            this.timeout(30000);
            var len = 255;
            var list = new Array(len);
            for (var i = 0; i < len; i++) list[i] = i;
            var that = this;
            async.each(list, function(index, callback) {
                //console.log('send', index);
                that.xbee.get_ni_string(function(err, data) {
                    //console.log('\treceive', index);
                    expect(err).to.be.null;
                    expect(data).to.have.ownProperty('status');
                    expect(data).to.have.ownProperty('ni');
                    expect(data.status).to.equal(that.xbee.AT_COMMAND_RESPONSE_STATUS_OK);
                    callback(err);
                });
            },
            function(err, result) {
                done();
            });
        });
        it("should reject 256th AT command", function(done) {
            this.timeout(30000);
            var len = 256;
            var list = new Array(len);
            for (var i = 0; i < len; i++) list[i] = i;
            var that = this;
            async.each(list, function(index, callback) {
                //console.log('send', index);
                that.xbee.get_ni_string(function(err, data) {
                    //console.log('\treceive', index);
                    if (index > 254) {
                        expect(err).to.equal(that.xbee.ERR_QUEUE_FULL);
                        callback();
                    }
                    else {
                        expect(err).to.be.null;
                        expect(data).to.have.ownProperty('status');
                        expect(data).to.have.ownProperty('ni');
                        expect(data.status).to.equal(
                            that.xbee.AT_COMMAND_RESPONSE_STATUS_OK);
                        callback();
                    }
                });
            },
            function(err, result) {
                done();
            });
        });
        it("should handle 1000 AT commands, 255 at a time", function(done) {
            this.timeout(100000);
            var len = 1000;
            var list = new Array(len);
            for (var i = 0; i < len; i++) list[i] = i;
            var that = this;
            async.eachLimit(list, 255, function(index, callback) {
                //console.log('send', index);
                that.xbee.get_ni_string(function(err, data) {
                    //console.log('\treceive', index);
                    expect(err).to.be.null;
                    expect(data).to.have.ownProperty('status');
                    expect(data).to.have.ownProperty('ni');
                    expect(data.status).to.equal(that.xbee.AT_COMMAND_RESPONSE_STATUS_OK);
                    callback(err);
                });
            },
            function(err, result) {
                done();
            });
        });
    });
});
