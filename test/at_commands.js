var expect = require('chai').expect;

// Test AT commands with the local xbee
describe("AT Commands", function() {
    // we'll generate a random one to make sure setting it works
    var random_ni_string;

    // setup the xbee
    before(function() {
        // generate random string
        random_ni_string = 'test' + parseInt(Math.random() * 1000);
    });

    describe("#set_ni_string", function() {
        it("should set the NI string", function(done) {
            var that = this;
            this.xbee.set_ni_string(random_ni_string, function(err, result) {
                expect(err).to.be.null;
                expect(result).to.have.ownProperty('status');
                expect(result.status).to.equal(that.xbee.AT_COMMAND_RESPONSE_STATUS_OK);
                done();
            });
        });
    });
    describe("#get_ni_string", function() {
        it("should return an NI string from the XBee", function(done) {
            var that = this;
            this.xbee.get_ni_string(function(err, data) {
                expect(err).to.be.null;
                expect(data).to.have.ownProperty('status');
                expect(data).to.have.ownProperty('ni');
                expect(data.status).to.equal(that.xbee.AT_COMMAND_RESPONSE_STATUS_OK);
                // should be what we just set it to
                expect(data.ni).to.equal(random_ni_string);
                done();
            });
        });
    });
    describe("#get_nt", function() {
        it("should return the Network discover Timeout from the XBee", function(done) {
            var that = this;
            this.xbee.get_nt(function(err, data) {
                expect(err).to.be.null;
                expect(data.status).to.equal(that.xbee.AT_COMMAND_RESPONSE_STATUS_OK);
                expect(data).to.have.ownProperty('status');
                expect(data).to.have.ownProperty('timeout');
                expect(data.timeout).to.be.a('number');
                done();
            });
        });
    });
});

