'use strict';
var _ = require('lodash');
var xmpp = require('node-xmpp');
var throttles = require('./getThrottles');
var sendMessageCreator = require('./sendMessage');
var setupMqttClient = require('./setupMqttClient');
var setupGatewayConfig = require('./setupGatewayConfig');
var sendActivity = require('./sendActivity');
var sendConfigActivity = require('./sendConfigActivity');
var createSocketEmitter = require('./createSocketEmitter');
var wrapMqttMessage = require('./wrapMqttMessage');

var xmppServer = function(config, parentConnection) {
  var io, redis;

  if (process.env.AIRBRAKE_KEY) {
    var airbrakeErrors = require("./airbrakeErrors");
    airbrakeErrors.handleExceptions()
  } else {
    process.on("uncaughtException", function(error) {
      return console.error(error.message, error.stack);
    });
  }

  if(config.redis && config.redis.host){
    var redis = require('./redis');
    var store = redis.createIoStore();
    store.subClient.psubscribe('socket.io#*', function(err){
      if (err){
        console.error('error setting up socket.io subcription', err);
      }
    });

    io = require('socket.io-emitter')(redis.client);
  }

  var socketEmitter = createSocketEmitter(io, null);

  function mqttEmitter(uuid, wrappedData, options){
    if(mqttclient){
      mqttclient.publish(uuid, wrappedData, options);
    }
  }

  var sendMessage = sendMessageCreator(socketEmitter, mqttEmitter, parentConnection);
  if(parentConnection){
    parentConnection.on('message', function(data, fn){
      if(data){
        var devices = data.devices;
        if (!_.isArray(devices)) {
          devices = [devices];
        }
        _.each(devices, function(device) {
          if(device !== config.parentConnection.uuid){
            sendMessage({uuid: data.fromUuid}, data, fn);
          }
        });
      }
    });
  }

  var xmppConfig = config.xmpp || {};
  var xmppPort = xmppConfig.port || 5222;
  var xmppHost = xmppConfig.host || '0.0.0.0';

  var c2s = new xmpp.C2SServer({
    autostart: false
  });

  c2s.listen(xmppPort, xmppHost, function () {
    console.log('XMPP listening at xmpp://' + xmppHost + ':' + xmppPort);
  });

  c2s.on('connect', function(client) {
    // That's the way you add mods to a given server.

    // Allows the developer to register the jid against anything they want
    c2s.on('register', function(opts, cb) {
      console.log('REGISTER')
      cb(true)
    })

    // Allows the developer to authenticate users against anything they want.
    client.on('authenticate', function(opts, cb) {
      console.log('AUTH' + opts.jid + ' -> ' +opts.password)
        cb(null, opts) // cb(false)
      })

    client.on('online', function() {
      console.log('ONLINE')
      client.send(new xmpp.Message({ type: 'chat' }).c('body').t('Hello there, little client.'))
    })

    // Stanza handling
    client.on('stanza', function(stanza) {
      console.log('STANZA' + stanza)
    })

    // On Disconnect event. When a client disconnects
    client.on('disconnect', function() {
      console.log('DISCONNECT')
    })
  });

}


module.exports = xmppServer;
