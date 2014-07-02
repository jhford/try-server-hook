"use strict";

var util = require('util');
var when = require('when');
var debug = require('debug')('try-server-hook:push_event_handler');
var platformFiles = require('../misc/platform_files.js');
var fork = require('child_process').fork;
var path = require('path');
var github = require('../misc/githubapi');

var BaseEventHandler = require('./base_event');

function jsonForPush(push) {
  var rando = Math.floor(Math.random() * 100000);
  var data = {
    git: {
      git_revision: push.after,
      remote: push.clone_url
    },
    tryhook_raw: {
      notes: 'This data is here for debugging, not downstream use',
    }
  };
  data.tryhook_raw[rando] = push;
  return JSON.stringify(data, null, '  ');
}

function PushEventHandler(downstreams) {
  BaseEventHandler.call(this, downstreams);
}

util.inherits(PushEventHandler, BaseEventHandler);

PushEventHandler.prototype.name = 'Incoming Github API Message';
PushEventHandler.prototype.parse = function (msg, callback) {
  var push = {};
  var upstreamPush = msg.content;
  try {
    push.type = 'push';
    push.who = upstreamPush.pusher.name;
    push.ref = upstreamPush.ref;
    push.owner = upstreamPush.repository.owner.name;
    push.repo_name = upstreamPush.repository.name;
    push.compare_url = upstreamPush.compare;
    push.created = upstreamPush.created;
    push.deleted = upstreamPush.deleted;
    push.forced = upstreamPush.forced;
    push.branch = upstreamPush.ref.replace(/^\/?refs\/heads\//, '');
    push.before = upstreamPush.before;
    push.after = upstreamPush.after;
  } catch (e) {
    return callback(e);
  }
  github.repos.get({user: push.owner, repo: push.repo_name}, function (err, result) {
    if (err) {
      return callback(err);
    }
    push.clone_url = result.clone_url;
    callback(null, push);
  });
}

PushEventHandler.prototype.interesting = function (msg) {
  if (msg && msg.type && msg.type === 'push') {
    return true;
  }
  return false;
}

function makePushCommitMsg(pushBranch, before, after, ghUser, callback) {
  github.user.getFrom({user: ghUser}, function(err, result) {
    if (err) {
      debug('API Call to figure out username has failed');
      return callback(err);
    }
    var fullName = result.name;
    var nameString = util.format('%s (%s)', fullName, ghUser);
    if (typeof fullName === 'undefined') {
      nameString = ghUser; 
    }
    var commitMsg = util.format('Gaia %s branch push by %s %s...%s',
                          pushBranch, nameString,
                          before.length > 7 ? before.slice(0, 7) : before,
                          after.length > 7 ? after.slice(0, 7) : after);
    return callback(null, commitMsg);
  });
}


PushEventHandler.prototype.handle = function (msg, callback) {
  if (!this.interesting(msg)) {
    debug('Ignoring uninteresting event');
    return callback(null);
  }

  this.parse(msg, function (err, push) {
    if (err) {
      debug('Failed to parse a Push event');
      return callback(err, false);
    }
    makePushCommitMsg(push.branch, push.before, push.after, push.who, function(err, commitMsg) {
      var child = fork(path.join(__dirname, '../misc/find_platform_files.js'));
    
      child.once('error', function(err) {
        debug('Error while talking to child process that figures out building platform json files');
        callback(err);
      });

      child.once('message', function(msg) {
        child.kill();
        if (msg.err) {
          return callback(msg.err, false);
        }
        if (!msg.contents) {
          return callback(new Error('Could not determine Gecko files'), false);
        }
        debug('Fetched platform file values for %s', push.branch);
        var user = push.who;
        var contents = msg.contents;
        contents['gaia.json'] = jsonForPush(push);
        return callback(null, null, {user: user, commit_message: commitMsg, contents: contents, push: push});
      })
      
      try {
        child.send(push.branch);
      } catch (err) {
        child.kill();
        return callback(err);
      }
    });
  });
};

module.exports = PushEventHandler;
