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
var authDevice = require('./authDevice');
var subEvents = require('./subEvents');

var xmppServer = function(config, parentConnection) {
  var io, redis;

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

  function streamMessages(req, res, topic){
    var subHandler = function(topic, msg){
      var stanza = new xmpp.Element(
        'message',
        { to: res.jid.user, type: msg.topic || 'chat' }
        ).c('body').t(JSON.stringify(msg.payload));
      res.send(stanza)
    };

    subEvents.on(topic, subHandler);

    res.once('disconnect', function(err) {
      subEvents.removeListener(topic, subHandler);
    });
  }

  function emitToClient(topic, device, msg){
    if(device.protocol === "mqtt"){
      // MQTT handler
      mqttEmitter(device.uuid, wrapMqttMessage(topic, msg), {qos:msg.qos || 0});
    }
    else{
      socketEmitter(device.uuid, topic, msg);
    }
  }

  var skynet = {
    sendMessage: sendMessage,
    gateway : setupGatewayConfig(emitToClient),
    sendActivity: sendActivity,
    sendConfigActivity: sendConfigActivity,
    throttles: throttles,
    emitToClient: emitToClient
  };

  var mqttclient = setupMqttClient(skynet, config);

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
    c2s.on('register', function(opts, cb) {
      cb(true)
    });

    client.on('authenticate', function(opts, cb) {
      authDevice(opts.username, opts.password, function (auth) {
        if (auth.authenticate) {
          cb(null, opts);
        }else{
          cb(new Error('Authentication failure'));
        }
      });
    });

    client.on('online', function() {
      var message = {
        devices: '*',
        topic: 'device-status',
        payload: {online: true}
      };
      skynet.sendMessage({uuid:client.jid.user}, message);
    });

    client.on('stanza', function(stanza) {
      if (stanza.is('message')) {
        var body = _.first(stanza.getChild('body').children);
        try {
          body = JSON.parse(body);
        } catch (error) {
        }
        var message = {
          devices: [_.first(stanza.to.split('@'))],
          topic: stanza.type,
          payload: body
        };
        skynet.sendMessage({uuid: client.jid.user}, message);
      } else if (stanza.is('presence')) {
        streamMessages(null, client, client.jid.user)
      }
    });

    client.on('disconnect', function() {
      var message = {
        devices: '*',
        topic: 'device-status',
        payload: {online: false}
      };
      skynet.sendMessage({uuid:client.jid.user}, message);
    });
  });
}

module.exports = xmppServer;
