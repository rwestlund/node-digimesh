var expect = require('chai').expect;
var digimesh = require('../digimesh');

var device = process.env.XBEE_DEVICE || "/dev/ttyU0";
var baud = process.env.XBEE_BAUD || 9600;

// test AT commands with the local xbee
describe("XBee", function() {
    var xbee;
    var random_ni_string;
    //this.timeout(5000);
    var neighbor;

    // setup the xbee
    before(function(done) {
        xbee = new digimesh({ device: device, baud: baud });
        xbee.on('open', done);
        random_ni_string = 'test' + parseInt(Math.random() * 1000);
    });

    describe("#set_ni_string", function() {
        it("should set the NI string", function(done) {
            xbee.set_ni_string(random_ni_string, function(err, result) {
                expect(err).to.be.null;
                expect(result.status).to.equal(0);
                done();
            });
        });
    });

    describe("#get_ni_string", function() {
        it("should return an NI string from the XBee", function(done) {
            xbee.get_ni_string(function(err, data) {
                expect(err).to.be.null;
                expect(data.status).to.equal(0);
                expect(data.ni).to.equal(random_ni_string);
                done();
            });
        });
    });

    describe("#discover_nodes", function() {
        it("should return a list of nodes", function(done) {
            this.timeout(14000);
            xbee.discover_nodes(function(err, nodes) {
                expect(err).to.be.null;
                expect(nodes.length).to.be.above(0);
                expect(nodes[0]).to.have.ownProperty('ni_string');
                expect(nodes[0]).to.have.ownProperty('source_addr');
                expect(nodes[0].source_addr).to.be.a('string');
                expect(nodes[0].source_addr.length).to.equal(16);
                neighbor = nodes[0].source_addr;
                done();
            });
        });
    });

    describe("#send_message", function() {
        it("should send a message to a node", function(done) {
            xbee.send_message({
                data: new Buffer('hello'),
                broadcast: false,
                dest_addr: neighbor
            }, function(err, result) {
                expect(err).to.be.null;
                expect(result).to.have.ownProperty('retries');
                expect(result).to.have.ownProperty('discovery_needed');
                expect(result.delivery_status).to.equal(0);
                done();
            });
        });
    });
});

