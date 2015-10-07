// Copyright (c) 2015 Randy Westlund, All rights reserved.
// This code is under the BSD-2-Clause license.

'use strict';
var expect = require('chai').expect;

// Test sending messages to other units
describe("Messaging Other Units", function() {
    // a discovered node that we'll bounce messages off of
    var neighbor;

    describe("#discover_nodes", function() {
        it("should return a list of nodes", function(done) {
            // ND is a long process
            this.timeout(this.xbee.nt_timeout + 2000);
            this.xbee.discover_nodes(function(err, nodes) {
                expect(err).to.be.null;
                expect(nodes.length).to.be.above(0);
                expect(nodes[0]).to.have.ownProperty('ni_string');
                expect(nodes[0]).to.have.ownProperty('addr');
                expect(nodes[0].addr).to.be.a('string');
                expect(nodes[0].addr.length).to.equal(16);
                neighbor = nodes[0].addr;
                done();
            });
        });
    });

    describe("#send_message", function() {
        it("should return a successful transmit status", function(done) {
            this.timeout(5000);
            var that = this;
            this.xbee.send_message({
                data: new Buffer('hello'),
                broadcast: false,
                addr: neighbor
            }, function(err, result) {
                expect(err).to.be.null;
                expect(result).to.have.ownProperty('retries');
                expect(result).to.have.ownProperty('discovery_needed');
                expect(result.status).to.equal(that.xbee.DELIVERY_STATUS_SUCCESS);
                done();
            });
        });
        it("should return 'not found' when given an nonexistent address", function(done) {
            this.timeout(5000);
            var that = this;
            this.xbee.send_message({
                data: new Buffer('sldfkj'),
                broadcast: false,
                addr: '0000000000000000'
            }, function(err, result) {
                expect(err).to.be.null;
                expect(result).to.have.ownProperty('retries');
                expect(result).to.have.ownProperty('discovery_needed');
                expect(result.discovery_needed).to.be.true;
                expect(result.status)
                    .to.equal(that.xbee.DELIVERY_STATUS_ROUTE_NOT_FOUND);
                done();
            });
        });
    });
});

