// Copyright (c) 2015 Randy Westlund, All rights reserved.
// This code is under the BSD-2-Clause license.

'use strict';
var expect = require('chai').expect;
var sinon = require('sinon');

// Testing events
describe("Events", function() {
    //describe("when always_fire_event is true", function() {
        // set the flag
        //this.xbee.always_fire_event = true;
    var neighbor;

    describe("@node_discovered", function() {
        it("should fire after discover_nodes", function(done) {
            this.timeout(this.xbee.nt_timeout + 2000);
            this.xbee.discover_nodes();
            var spy = sinon.spy();
            this.xbee.on('node_discovered', spy);
            setTimeout(function() {
                expect(spy.called).to.be.true;
                expect(spy.firstCall.args[0]).to.have.ownProperty('ni_string');
                expect(spy.firstCall.args[0]).to.have.ownProperty('addr');
                expect(spy.firstCall.args[0].addr).to.be.a('string');
                expect(spy.firstCall.args[0].addr.length).to.equal(16);
                neighbor = spy.firstCall.args[0].addr;
                done();
            }, this.xbee.nt_timeout + 1000);
        });
    });
    describe("@transmit_status", function() {
        it("should fire after sending a message if no callback is passed", function(done) {
            var that = this;
            this.xbee.send_message({
                data: new Buffer('hello'),
                broadcast: false,
                addr: neighbor
            });
            var spy = sinon.spy();
            this.xbee.on('transmit_status', spy);
            setTimeout(function() {
                expect(spy.calledOnce).to.be.true;
                expect(spy.firstCall.args[0]).to.have.ownProperty('retries');
                expect(spy.firstCall.args[0]).to.have.ownProperty('discovery_needed');
                expect(spy.firstCall.args[0].status)
                    .to.equal(that.xbee.DELIVERY_STATUS_SUCCESS);
                done();
            }, 1000);
        });
        it("should not fire after sending a message if callback is passed", function(done) {
            var that = this;
            this.xbee.send_message({
                data: new Buffer('hello'),
                broadcast: false,
                addr: neighbor
            }, function() {});
            var spy = sinon.spy();
            this.xbee.on('transmit_status', spy);
            setTimeout(function() {
                expect(spy.called).to.be.false;
                done();
            }, 1000);
        });
        it("should fire after send if no callback is passed and "
            + "always_fire_event", function(done) {
            this.xbee.always_fire_event = true;
            var that = this;
            this.xbee.send_message({
                data: new Buffer('hello'),
                broadcast: false,
                addr: neighbor
            }, function() {});
            var spy = sinon.spy();
            this.xbee.on('transmit_status', spy);
            setTimeout(function() {
                expect(spy.calledOnce).to.be.true;
                expect(spy.firstCall.args[0]).to.have.ownProperty('retries');
                expect(spy.firstCall.args[0]).to.have.ownProperty('discovery_needed');
                expect(spy.firstCall.args[0].status)
                    .to.equal(that.xbee.DELIVERY_STATUS_SUCCESS);
                that.xbee.always_fire_event = false;
                done();
            }, 1000);
        });
    });
});
