var fs = require('fs');
var path = require('path');
var when = require('when');
var nodefn = require('when/node');
var hg = require('hg');
var temp = require('temp');
var util = require('util');
var rimraf = require('rimraf');
var exec = require('child_process').exec;

var config = require('./config');
var hgId = require('./hg_id');


function showHgOutput(output) {
  if (!output) {
    console.log('No HG Output');
    return
  }
  output.forEach(function (e) {
    var func = console.error;
    body = e.body.replace(/\n$/, '')
    // Output, Result, Debug, Error
    switch (e.channel) {
      case 'o':
      case 'r':
      case 'd':
        func = console.log;
        break;
    }
    func(body);
  });
}


function handleErr(repo, err, retry, output, callback) {
  console.log('Failed command output:');
  showHgOutput(output);
  console.log('Cleaning up ' + repo.path + ' after failure ' + err);
  rimraf(repo.path, function (rmrferr) {
    if (rmrferr) {
      console.warn('ERROR CLEANING UP ' + repo.path);
    }
    callback(err, retry);
  });
}


function commit(user, message, contents, platformDict, callback) {
  var repoDir = temp.path({prefix: 'gaia-try-hg'});
  var gaiaJsonPath = path.join(repoDir, 'gaia.json');
  var commitOpts = {
    '--message': message,
    '--user': user
  }
  var ssh_cmd = util.format('ssh -i %s -l %s', 
                            config.get('HG_USER'),
                            config.get('HG_KEY'));
  var hg_url = config.get('HG_REPOSITORY');

  console.log('Using %s to talk to %s', ssh_cmd, hg_url);

  hg.clone(hg_url, repoDir, {'--ssh': ssh_cmd}, function(err, output) {
    if (err) {
      console.log('Failed to clone ' + hg_url); 
      showHgOutput(output);
      return callback(err, true);
    };
    var repo = new hg.HGRepo(repoDir); // The convenience API sucks
    console.log('Cloned to ' + repoDir);
    fs.writeFile(gaiaJsonPath, contents, function (err) {
      if (err) handleErr(repo, err, true, callback);
      console.log('Wrote new gaia.json to ' + gaiaJsonPath);

      repo.commit(commitOpts, function (err, output) {
        if (err) handleErr(repo, err, true, output, callback);
        console.log('Commit success');
        repo.push(hg_url, {'--ssh': ssh_cmd, '--force': ''}, function(err, output) {
          if (err) handleErr(repo, err, true, output, callback);
          hgId(repo, function (err, id) {
            if (err) handleErr(repo, err, false, callback);
            rimraf(repo.path, function(err) {
              if (err) {
                console.warn('Commit succedded, delete failed ' + err);
              }
              callback(null, null, id);
            });
          });
        });
      });
    });
  });
}


module.exports = {
  commit: commit,
}
