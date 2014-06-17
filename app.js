"use strict";
var express = require('express');
var when = require('when');
var fs = require('fs');
var path = require('path');
var debug = require('debug')('try-server-hook:app');

var config = require('./config');

var Connection = require('./msg_broker');

// Event Streams
var IncomingGithubStream = require('./event_streams/incoming_github_stream');
var CommitEventStream = require('./event_streams/commit_event_stream');
var NotificationEventStream = require('./event_streams/notification_event_stream');
var IRCQueueEventStream = require('./event_streams/irc_queue_event_stream');

// Event Handlers
var PREventHandler = require('./event_handlers/pr_event_handler');
var IRCEventHandler = require('./event_handlers/irc_event_handler');
var GithubPostHandler = require('./event_handlers/github_post_handler');
var StartMonitoringEventHandler = require('./event_handlers/start_monitoring_event_handler');

function error(msg) {
  return JSON.stringify({'error': msg}) + '\n';
}

function success(msg) {
  return JSON.stringify({'outcome': msg}) + '\n'
}

var app = express();
app.use(express.json());
app.use(express.urlencoded());

app.connection = new Connection();
app.githubEvents = new IncomingGithubStream();
app.commitEvents = new CommitEventStream();
app.notificationEvents = new NotificationEventStream();
app.ircSendEvents = new IRCQueueEventStream();
app.prEventHandler = new PREventHandler(app.commitEvents);
app.ircEventHandler = new IRCEventHandler(app.ircSendEvents);
app.githubPostHandler = new GithubPostHandler();
app.startMonitoringEventHandler = new StartMonitoringEventHandler();

app.get('/', function(req, res) {
  res.send('200', 'Server is up!');
});

/* curl -X POST -d @sample_new_pr_payload.json http://localhost:7040/github/v3 \
     --header "Content-Type:application/json" \
     --header "X-GitHub-Event:pull_request" \
     --header "X-GitHub-Delivery:testing-guid" */
app.post('/github/v3', function(req, res) {
  var type = req.get('X-GitHub-Event');
  var delivery_id = req.get('X-GitHub-Delivery');

  debug('Api received a ' + type);
  app.githubEvents.insertJson({type:type, delivery_id:delivery_id, content:req.body})
    .then(
      function(outcome) {
        res.send(200, success(outcome));
      },
      function(outcome) {
        if (typeof outcome === 'object' && outcome.message) {
          console.log('ERROR!');
          console.log(outcome.stack || 'no stack');
          res.send(500, error(outcome.message));
        } else {
          res.send(500, error(outcome));
        }
      })
    .done();
});

// Start up the app!
app.connection.open()
  .then(app.githubEvents.bindConnection(app.connection))
  .then(app.commitEvents.bindConnection(app.connection))
  .then(app.ircSendEvents.bindConnection(app.connection))
  .then(app.notificationEvents.bindConnection(app.connection))
  .then(function() {
    return app.connection.createChannel().then(function (ch) {
      ch.prefetch(1);
      return when.all([
        app.githubEvents.addConsumer(app.prEventHandler.makeAction(), ch, 'github_api_incoming'),
        app.notificationEvents.addConsumer(app.ircEventHandler.makeAction(), ch, 'irc_start'),
        app.notificationEvents.addConsumer(app.githubPostHandler.makeAction(), ch, 'pr_comment_start'),
        //app.notificationEvents.addConsumer(app.startMonitoringEventHandler.makeAction(), ch, 'start_monitoring'),
      ]);
    });
  })
  .then(function() {
    return when(app.listen(config.get('PORT') || 7040));
  }).done()
debug('Starting up server!');
