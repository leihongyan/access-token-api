var STORE = require('store-ttl');
var _ = require('lodash');
var util = require('./util');
var async = require('async');
var Promise = require('bluebird');
function randomToken(len) {
  return Math.random().toString(len || 26).slice(2);
}

function Token(config) {
  if (!_.isObject(config)) {
    config = {};
  }
  config.storeConfig = config.storeConfig || {};
  config.count = config.count || 5;
  this.config = config;
  this.store = new STORE(config.storeConfig);
  this.config.webTokenVarName = this.config.webTokenVarName || 'encrypt_api_tokenStr'
}

Token.prototype.issueCb = function(ttl, count, token, cb) {
  var store = this.store;
  store.set(token, count, ttl, function(err, data) {
    if (!err && data) {
      cb(null, token);
    } else {
      cb(err || 'issue token error : ' + data);
    }
  });
}
Token.prototype.issue = function (ttl, count, token, cb) {
  var that = this;
  if (_.isFunction(ttl)) {
    return ttl('issue api must be set ttl.');
  }
  if(_.isFunction(count)) {
    cb = count;
    token = randomToken();
    count = this.config.count;;
  }
  if (_.isString(count) && _.isFunction(token)) {
    cb = token;
    token = count;
    count = this.config.count;
  }
  if (_.isNumber(count) && _.isFunction(token)) {
    cb = token;
    token = randomToken();
  }
  if (!_.isFunction(cb)) {
    throw 'issue api is async function, you must have callback function.'
  }
  return new Promise(function (resolve, reject) {
    that.issueCb(ttl, count, token, function (err, data) {
      if (err) {
        return reject(err)
      }
      resolve(data)
    })
  }).asCallback(cb)
}
Token.prototype.verifyCb = function(token, cb) {
  var store = this.store;
  store.get(token, function(err, data) {
    if (!err && data) {
      cb(null, data.data);
    } else {
      cb(err || 'token : ' + token + ' haved expire.')
    }
  });
}
Token.prototype.verify = function(token, cb) {
  var that = this;
  return new Promise(function (resolve, reject) {
    that.verifyCb(token, function (err, data) {
      if (err) {
        return reject(err)
      }
      resolve(data)
    })
  }).asCallback(cb)
}
Token.prototype.removeCb = function(token, cb) {
  var store = this.store;
  store.remove(token, function(err, data) {
    cb(err, data);
  });
}
Token.prototype.remove = function(token, cb) {
  var that = this;
  return new Promise(function (resolve, reject) {
    that.removeCb(token, function (err, data) {
      if (err) {
        return reject(err)
      }
      resolve(data)
    })
  }).asCallback(cb)
}
Token.prototype.declineCb = function(token, cb) {
  var store = this.store;
  store.get(token, function(err, data) {
    if (!err && data) {
      store.update(token, --data.data, function(err, data) {
        cb(err, (data && data.data));
      });
    } else {
      cb(err || 'not exists or expired token : ' + token + '.')
    }
  })
}
Token.prototype.decline = function(token, cb) {
  var that = this;
  return new Promise(function (resolve, reject) {
    that.declineCb(token, function (err, data) {
      if (err) {
        return reject(err)
      }
      resolve(data)
    })
  }).asCallback(cb)
}
Token.prototype.webInjectCb = function(html, token, callback) {
  if (!_.isString(html)) {
    return callback('html must be string', html);
  }
  var webTokenVarName = this.config.webTokenVarName;
  var webInject = this.config.webInject || function(html, token, callback) {
    var bodyEndStr = '</body>';
    var bodyStartStr = '<body';
    var tokenId = '_' + util.generateSalt(Math.ceil(Math.random() * 10));
    var bodyStarIndex = html.indexOf(bodyStartStr);
    var bodyEndIndex = html.indexOf(bodyEndStr);
    var htmlTagLastIndexs = util.matchHtmlTags(html.substring(bodyStarIndex, bodyEndIndex + 1));
    if (!htmlTagLastIndexs.length) {
      htmlTagLastIndexs[0] = bodyEndIndex - bodyStarIndex;
    }
    var htmlTagLen = htmlTagLastIndexs.length;
    var tokenLen = token.length;
    var times = Math.floor(htmlTagLen / tokenLen);
    var randomIndex = 0;
    var addLen = 0;
    var scriptStr = 'var r="";function g(id){return document.getElementById(id).innerHTML}';
    for (var i = 0; i < tokenLen; i++) {
      var htmlTag = util.makeHtmlTag(tokenId + i, token[i]);
      randomIndex += Math.floor(Math.random() * times);
      if (!htmlTagLastIndexs[randomIndex]) {
        randomIndex = htmlTagLen - 1;
      }
      var curIndex = bodyStarIndex + htmlTagLastIndexs[randomIndex] + addLen;
      var prevHtml = html.substring(0, curIndex);
      var nextHtml = html.substr(curIndex);
      scriptStr += 'r += g("' + (tokenId + i) + '");';
      if (i === tokenLen - 1) {
        scriptStr += 'w.' + webTokenVarName + '=r;';
        html = prevHtml.concat(htmlTag, '<script>(function(w){' + scriptStr + '})(window)</script>', nextHtml);
      } else {
        html = prevHtml.concat(htmlTag, nextHtml);
      }
      addLen += htmlTag.length;
    }
    callback(null, html);
  };
  webInject.call(this, html, token, callback);
}
Token.prototype.webInject = function(html, token, cb) {
  var that = this;
  return new Promise(function (resolve, reject) {
    that.webInjectCb(html, token, function (err, data) {
      if (err) {
        return reject(err)
      }
      resolve(data)
    })
  }).asCallback(cb)
}
Token.prototype.pass = function(token, cb) {
  var that = this;
  this.verify(token, function(err, data) {
    if (err) {
      return cb(err, {
        code: -1,
        msg: err,
        passed: false
      });
    }
    if (data) {
      that.decline(token, function(err, count) {
        if (!err) {
          return cb(null, {
            code: 0,
            msg: 'ok',
            passed: true,
            count: count
          })
        }
        cb(err, {
          code: -2,
          msg: 'decline token times error : ' + err,
          passed: false
        })
      });
    } else {
      cb(null, {
        code: 1,
        msg: 'access token times haved used out.',
        passed: false,
        count: 0
      })
    }
  })
}
Token.prototype.passPromise = function(token, cb) {
  var that = this;
  return new Promise(function (resolve, reject) {
    that.pass(token, function (err, data) {
      if (err) {
        return reject(err)
      }
      resolve(data)
    })
  }).asCallback(cb)
}
Token.prototype.limitCb = function(apiName, ttl, callCount, cb) {
  var _this = this;
  async.waterfall([
      function(cb) {
          var code = 0;
          _this.verify(apiName, function(err, count) {
              if (err) {
                  code = 1;
              }
              if (count === 0) {
                  code = 2;
              }
              cb(null, code);
          })
      },
      function(code, cb) {
          switch (code) {
              case 0:
                  _this.decline(apiName, function(err, count) {
                      cb(err);
                  })
                  break;
              case 1:
                  _this.issue(ttl, callCount, apiName, function(err, data) {
                      cb(err);
                  })
                  break;
              case 2:
                  cb(apiName + 'limited number of calls.');
                  break;
              default:
                  cb(apiName + 'called error.');
          }
      }
  ], function(err) {
      cb(err);
  })
}
Token.prototype.limit = function(apiName, ttl, callCount, cb) {
  var that = this;
  if (!_.isString(apiName)) {
      cb = arguments[arguments.length-1];
      return cb('the first param must be string');
  }
  return new Promise(function (resolve, reject) {
    that.limitCb(apiName, ttl, callCount, function (err, data) {
      if (err) {
        return reject(err)
      }
      resolve(data)
    })
  }).asCallback(cb)
}
module.exports = Token;