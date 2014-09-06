var mdns = require('mdns');

var mdnsServer = function(config) {
  return mdns.createAdvertisement(
    mdns.tcp('meshblu'), 
    parseInt(config.httpPort, 10)
  );
}

module.exports = mdnsServer;
