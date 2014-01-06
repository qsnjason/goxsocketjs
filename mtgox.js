/*jshint globalstrict: true*/
/*jshint node: true*/
/*jshint browser: true*/
/**@preserve
QSN MtGox Javascript Websocket Client for Node.js and HTML5 Browsers.

Copyright (c) 2013 Quantitative Signals Network (https://www.quantsig.net).

Distributed under the terms of the MIT License (http://opensource.org/licenses/MIT).

*/
"use strict";
function GoxClient(conf) {
 var c = this;
 c.name = 'mtgox';
 c.conf = conf || {};
 c.conf.depthcleanup = c.conf.depthcleanup || 1000;
 c.conf.currency = c.conf.currency || 'USD';
 c.conf.currencystr = 'BTC' + c.conf.currency;
 c.conf.connstr = c.conf.connstr || 'wss://websocket.mtgox.com/mtgox?Currency=' + c.conf.currency;
 c.conf.depthurl = c.conf.depthurl || 'http://data.mtgox.com/api/1/' + c.conf.currencystr + '/depth/fetch';
 c.conf.currencydescurl = c.conf.currencydescurl || 'http://data.mtgox.com/api/1/generic/currency?currency=' + c.conf.currency;
 c.state = {
  depth: { asks: {}, bids: {} },
  ticker: { bid: 0, ask: 0 },
  last: { price: 0, volume: 0 },
  trades: [],
  orders: [],
  pending: {},
  account: { balance: {} },
  account_channel: null,
  connected: false,
  conf: c.conf,
  btcdivisor: 100000000,
  minimum_order: 0.01,
  inputMessages: 0,
  outputMessages: 0,
  nonce: (new Date()).getTime() * 1000,
  on: c.conf.on || {}
 };

 if ( c.conf.minode ) {
  c.http = require('http');
  c.btoa = require('btoa');
  c.crypto = require('crypto');
  require(c.conf.minode).websocket;
 }

 //Low level methods
 this.getState = function() {
  return(c.state);
 };

 this.on = function(ev,cb) {
  c.state.on[ev] = cb;
 };

 this.btcDivisor = function() {
  return(c.state.btcdivisor);
 };

 this.fiatDivisor = function() {
  return(c.state.price_divisor);
 };

 this.minimumOrder = function() {
  return(c.state.btcdivisor * c.state.minimum_order);
 };

 this.sendMessage = function(msg) {
  if ( msg ) {
   if ( c.socket && c.state.connected ) {
    try {
     c.socket.send(JSON.stringify(msg));
    } catch(er) {
     c.logerr(['sendMessage: error, cannot send message',JSON.stringify(er)]);
    }
    c.state.outputMessages++;
   } else {
    c.logerr('sendMessage: error, not connected');
   }
  } else {
   c.logerr('sendMessage: error, null message');
  }
 };

 if ( c.conf.apikey && c.conf.apisecret ) {
  if ( c.conf.minode ) {
   this.sendPrivateMessage = function(msg,cb) {
    var bytes = [], kstr, req, reqstr, reqlist, hmac, sign, str;
    c.state.nonce++;
    msg.id = c.hasher(c.state.nonce.toString());
    msg.nonce = c.state.nonce;

    if ( ! msg.params ) {
     msg.params = {};
    }
    str = JSON.stringify(msg);

    hmac = c.crypto.createHmac('sha512', new Buffer(c.conf.apisecret, 'base64'));
    hmac.update(str);
    kstr = c.conf.apikey.split('-').join('');
    bytes = hmac.digest('binary');
    reqlist = [c.hex2a(kstr), bytes, str];
    reqstr = c.btoa(reqlist.join(''));

    req = {
     op: 'call',
     id: msg.id,
     call: reqstr,
     context: 'mtgox.com'
    };

    if ( cb ) {
     c.state.pending[msg.id] = cb;
    }

    c.sendMessage(req);
    return;
   };
  } else {
   this.sendPrivateMessage = function(msg,cb) {
    var bytes = [], kstr, req, reqstr, reqlist, sha, sign, str;
    c.state.nonce++;
    msg.id = c.hasher(c.state.nonce.toString());
    msg.nonce = c.state.nonce;

    if ( ! msg.params ) {
     msg.params = {};
    }
    str = JSON.stringify(msg);

    sha = new jsSHA(str,'TEXT');
    kstr = c.conf.apikey.split('-').join('');
    sign = sha.getHMAC(c.conf.apisecret, 'B64', 'SHA-512', 'B64');
    bytes = atob(sign);
    reqlist = [c.hex2a(kstr), bytes, str];
    reqstr = btoa(reqlist.join(''));

    req = {
     op: 'call',
     id: msg.id,
     call: reqstr,
     context: 'mtgox.com'
    };

    if ( cb ) {
     c.state.pending[msg.id] = cb;
    }

    c.sendMessage(req);
    return;
   };
  }

  // Extract bytes from HEX API Key
  this.hex2a = function(hex) {
   var str = '';
   for (var i = 0; i < hex.length; i += 2) {
    str += String.fromCharCode(parseInt(hex.substr(i, 2), 16)); 
   }
   return str;
  };

  // Hasher required for login
  if ( c.conf.minode ) {
   this.hasher = function(str) {
    var hasher = c.crypto.createHash('sha256');
    var hash = hasher.update(str, 'utf8');
    return(hash.digest('hex'));
   };
  } else {
   this.hasher = function(str) {
    var sha = new jsSHA(str, 'TEXT');
    return(sha.getHash('SHA-256','HEX'));
   };
  }
 }

 this.receiveResultMessage = function(message) {
  if ( message.id && c.state.pending[message.id] ) {
   c.state.pending[message.id](message);
   delete(c.state.pending[message.id]);
   return;
  } else if ( c.conf.lowlevel && c.on.message ) {
   c.on.message(message);
   return;
  } else if ( ! c.conf.lowlevel && message.result && message.result.Wallets ) {
   c.readAccount(message.result);
   if ( c.state.on.account ) {
    c.state.on.account(c.state.account,message);
   }
   return;
  }
  c.logger(['unknown result message', JSON.stringify(message)]);
 };

 this.connect = function(cb) {
  var messageSwitch, connstr, onopen, sock, message;

  if ( cb ) {
   onopen = cb;
  } else if ( c.state.on.open ) {
   onopen = c.state.on.open;
  }

  c.on('open', function() {
   if ( onopen ) {
    c.on('open', onopen);
    if ( ! c.conf.lowlevel && ! c.state.ticker_channel ) {
     c.loadCurrencyDescription(function() {
      if ( c.state.account_channel ) {
       c.subscribeAccount();
      }
      onopen();
     });
    } else {
     onopen();
    }
   } else {
    delete(c.state.on.open);
   }
  });

  if ( c.conf.lowlevel ) {
   messageSwitch = function(msg) {
    message = c.parseJSON(msg.data);
    if ( message.id && c.state.pending[message.id] ) {
     c.receiveResultMessage(message);
    } else {
     if ( c.state.on.message ) {
      c.state.on.message(message);
     }
    }
   };
  } else {
   messageSwitch = c.messageSwitch;
  }

  c.logger(['connecting to', c.conf.connstr]);
  sock = new WebSocket(c.conf.connstr);
  sock.onmessage = messageSwitch;
  sock.onopen = function(event) {
   c.logger('socket connected');
   c.state.connected = true;
   if ( c.state.on.open ) {
    c.state.on.open();
   }
  };
  sock.onclose = function() {
   c.logger('socket closed');
   c.state.connected = false;
   if ( c.state.on.close ) {
    c.state.on.close();
   }
  };
  sock.onerror = function(err) {
   if ( c.state.on.error ) {
    c.state.on.error(err);
   }
  };
  c.socket = sock;
 };

 //High level methods
 if ( ! c.conf.lowlevel ) {
  this.subscribeDepth = function(cb) {
   c.logger('subscribing to depth');
   c.state.subscribeDepth = true;
   c.getDepthREST(function(d) {
    c.handleDepth(d);
    if ( cb ) {
     cb(d);
    }
    if ( c.conf.refreshdepth ) {
     c.refreshDepth();
    }
    c.getDepth = function(side) {
     return(c.state.depth[side]);
    };
   });
  };

  this.unsubscribeDepth = function() {
   c.logger('unsubscribing from depth');
   c.sendMessage({ op: 'unsubscribe', type: 'depth' });
  };

  this.unsubscribeTrades = function() {
   c.logger('unsubscribing from trades');
   c.sendMessage({ op: 'unsubscribe', type: 'trades' });
  };

  this.unsubscribeTicker = function() {
   c.logger('unsubscribing from ticker');
   c.sendMessage({ op: 'unsubscribe', type: 'ticker' });
  };

  this.receiveRemarkMessage = function(msg) {
   if ( msg.id && c.state.pending[msg.id] ) {
    c.state.pending[msg.id](msg);
    delete(c.state.pending[msg.id]);
    return;
   }
   switch(msg.success) {
    case true:
     c.logger(['success message', msg.message]);
     return;
    break;
    case false:
     c.logerr(['error message', JSON.stringify(msg)]);
     return;
    break;
   }
   c.logger(['unknown remark message', JSON.stringify(msg)]);
  };

  this.messageSwitch = function(msg) {
   var message = c.parseJSON(msg.data);
   c.state.inputMessages++;
   switch(message.op) {
    case "remark":
     c.receiveRemarkMessage(message);
     return;
    break;
    case "private":
     c.receivePrivateMessage(message);
     return;
    break;
    case "result":
     c.receiveResultMessage(message);
     return;
    break;
   }
   c.logger(['unknown websocket message', JSON.stringify(message)]);
  };

  this.receivePrivateMessage = function(message) {
   if ( message.private ) {
    switch ( message.private ) {
     case "depth":
      c.depthMessage(message.depth);
      return;
     break;
     case "ticker":
      c.tickerMessage(message.ticker);
      return;
     break;
     case "trade":
      c.tradeMessage(message.trade);
      return;
     break;
     case "user_order":
      c.userOrderMessage(message.user_order);
      return;
     break;
     case "wallet":
      c.readWalletUpdate(message.wallet);
      return;
     break;
    }
   }
   c.logger(['mtgox unknown private message', JSON.stringify(message)]);
  };

  this.tickerMessage = function(m) {
   var ticker = c.state.ticker;
   var bid, ask, d;
   if ( m.avg.currency !== c.conf.currency ) {
    return;
   }
   if ( m && m.buy && m.sell ) {
    ticker.bid = parseInt(m.buy.value_int, 10);
    ticker.ask = parseInt(m.sell.value_int, 10);
   }
   if ( c.state.subscribeDepth && ! c.state.depthCleanupTimer ) {
    c.state.depthCleanupTimer = setTimeout(function() {
     c.depthCleanup();
    }, c.conf.depthcleanup);
   }
   if ( c.state.on.ticker ) {
    c.state.on.ticker({ instr: m.avg.currency, bid: ticker.bid, ask: ticker.ask }, m);
   }
  };
 
  this.tradeMessage = function(m) {
   var trade;
   if ( m.price_currency !== c.conf.currency ) {
    return;
   }
   trade = {
    volume: parseInt(m.amount_int, 10),
    price: parseInt(m.price_int, 10),
    type: m.properties,
    currency: m.price_currency,
    timestamp: m.tid
   };
   c.state.last.price = trade.price;
   c.state.last.volume = trade.volume;
   c.state.last.type = trade.type;
   c.state.last.timestamp = trade.timestamp;
   c.state.trades.push(trade);
   if ( c.state.trades.length > 1000 ) {
    c.state.trades.shift();
   }
   if ( c.state.subscribeDepth && ! c.state.depthCleanupTimer ) {
    c.state.depthCleanupTimer = setTimeout(function() {
     c.depthCleanup();
    }, c.conf.depthcleanup);
   }
   if ( c.state.on.trade ) {
    c.state.on.trade(trade,m);
   }
  };
 
  this.userOrderMessage = function(m) {
   if ( c.state.on.order ) {
    c.state.on.order(m);
   }
  };

  this.loadCurrencyDescription = function(cb) {
   var retry = function() {
    if ( ! c.state.curdesctimeout ) {
     c.state.curdesctimeout = 30000;
    } else {
     if ( c.state.curdesctimeout < 300000 ) {
      c.state.curdesctimeout = c.state.curdesctimeout + 10000;
     }
    }
    setTimeout(function() {
     c.loadCurrencyDescription(cb);
    }, c.state.curdesctimeout);
   };
   c.getCurrencyDescription(function(d) {
    if ( ! d ) {
     c.logerr('failed to get currency description from exchange');
     retry();
     return;
    }
    if ( cb ) {
     c.state.curdesctimeout = 30000;
     cb();
    }
   });
  };
 
  this.getCurrencyDescription = function(cb) {
   c.getCurrencyDescriptionREST(function(desc) {
    if ( desc && desc.return && desc.return.decimals ) {
     c.state.ticker_channel = desc.return.ticker_channel;
     c.state.depth_channel = desc.return.depth_channel;
     c.state.price_divisor = Math.pow(10, parseInt(desc.return.decimals, 10));
     if ( c.conf.debug ) {
      c.logger(['price divisor set to', c.state.price_divisor]);
     }
     if ( cb ) {
      cb(desc);
     }
    } else {
     if ( cb ) {
      cb(null);
     }
    }
   });
  };

  this.getPrices = function(side) {
   var d = c.state.depth[side];
   var prices = [];
   Object.keys(d).forEach(function(p) {
    prices.push(parseInt(p, 10));
   });
   prices.sort(function(a, b) { return(a - b); });
   return(prices);
  };
 
  this.getRate = function() {
   var ticker = c.state.ticker;
   var rate;
   if ( ticker.ask <= ticker.bid ) {
    rate = ticker.ask;
   } else {
    rate = (((ticker.ask - ticker.bid) / 2) + ticker.bid);
   }
   return(rate / c.state.price_divisor);
  };
 
  this.getPrice = function(side) {
   var prices = c.getPrices(side + 's');
   var d = c.state.depth[side + 's'];
   var len = prices.length - 1;
   if ( side === 'ask' ) {
    return({ price: prices[0], volume: d[prices[0]] });
   } else {
    return({ price: prices[len], volume: d[prices[len]] });
   }
  };
 
  this.depthMessage = function(m) {
   var price, volume;
   var depth = c.state.depth;
   if ( m.currency === c.conf.currency ) {
    price = m.price_int;
     volume = parseInt(m.volume_int, 10);
    if ( m.type_str === 'ask' ) {
     if ( depth.asks[price] ) {
      depth.asks[price] = depth.asks[price] + volume;
     } else {
      depth.asks[price] = volume;
     }
     if ( depth.asks[price] <= 0 ) {
      delete(depth.asks[price]);
     }
    }
    if ( m.type_str === 'bid' ) {
     if ( depth.bids[price] ) {
      depth.bids[price] = depth.bids[price] + volume;
     } else {
      depth.bids[price] = volume;
     }
     if ( depth.bids[price] <= 0 ) {
      delete(depth.bids[price]);
     }
    }
    if ( c.state.on.depth ) {
     c.state.on.depth({ instr: m.currency, price: price, volume: volume }, m);
    }
   }
  };
 
  this.depthCleanup = function() {
   var depth = c.state.depth;
   var ask = c.getPrice('bid');
   var bid = c.getPrice('ask');
   var last = c.state.last.price;
   var ticker = c.state.ticker;
   var crossed = [];
   var d, prices;
   if ( ticker.ask > 0 && ticker.bid > 0 && last > 0 ) {
    d = depth.asks;
    if ( ! d[ticker.ask] && ticker.ask > 0 ) {
     if ( c.conf.debug ) {
      c.logger(['adding ticker ask to depth', ticker.ask]);
     }
     d[ticker.ask] = 1;
    }
    prices = c.getPrices('asks');
    prices.forEach(function(price) {
     if ( price < ticker.ask || price < (last - 1)) {
      if ( c.conf.debug ) {
       c.logger(['deleting bogus ask from depth', price]);
      }
      delete(d[price]);
     }
    });
    d = depth.bids;
    if ( ! d[ticker.bids] && ticker.bid > 0 ) {
     if ( c.conf.debug ) {
      c.logger(['adding ticker bid to depth', ticker.bid]);
     }
     d[ticker.bid] = 1;
    }
    prices = c.getPrices('bids');
    prices.forEach(function(price) {
     if ( price > ticker.bid || price > (last + 1) ) {
      if ( c.conf.debug ) {
       c.logger(['deleting bogus bid from depth', price]);
      }
      delete(d[price]);
     }
    });
   }
   if ( c.state.depthCleanupTimer ) {
    delete(c.state.depthCleanupTimer);
   }
  };

  this.handleDepth = function(d) {
   if ( ! d ) {
    c.logerr('received null depth');
    return;
   }
   var bdata = d['return'];
   var alen = bdata.asks.length;
   var blen = bdata.bids.length;
   var depth = c.state.depth;
   var asks = depth.asks = {};
   var bids = depth.bids = {};
   var price, volume;
   if ( c.conf.debug ) {
    c.logger('received depth, size ' + alen + ' asks, ' + blen + ' bids');
   }
   for ( var i = 0; i < alen; i++ ) {
    price = bdata.asks[i].price_int;
    volume = parseInt(bdata.asks[i].amount_int, 10);
    asks[price] = volume;
   }
   for ( i=0; i<blen; i++ ) {
    price = parseInt(bdata.bids[i].price_int, 10);
    volume = parseInt(bdata.bids[i].amount_int, 10);
    bids[price] = volume;
   }
   return;
  };

  this.refreshDepth = function() {
   if ( ! c.state.refreshdepthtimeout && c.conf.refreshdepth ) {
    c.state.refreshdepthtimeout = setTimeout(function() {
     c.getDepthREST(function(d) {
      delete(c.state.refreshdepthtimeout);
      c.handleDepth(d);
      if ( c.conf.debug ) {
       c.logger('refreshed depth');
      }
      c.refreshDepth();
      return;
     });
    }, (c.conf.refreshdepth * 1000 * 60));
   }
  };

  if ( c.conf.apikey && c.conf.apisecret ) {
   this.getAccount = function(cb) {
    c.sendPrivateMessage(
     { call: c.conf.currencystr + '/info' },
     function(info) {
      var acc = info.result;
      if ( acc ) {
       c.readAccount(acc);
      }
      if ( cb ) {
       cb(c.state.account,info);
      }
     }
    );
   };

   this.subscribeAccount = function(cb) {
    if ( cb ) {
     c.state.on.account = cb;
    }
    c.logger(['subscribing to account updates']);
    c.sendPrivateMessage(
     { call: 'private/idkey' },
     function(res) {
      if ( c.conf.debug ) {
       if ( res && res.result ) {
        c.logger(['received id key',res.result]);
       }
      }
      if ( res.result ) {
       c.state.account_channel = res.result;
       c.getAccount(function() {
        c.sendMessage({ op: 'mtgox.subscribe', key: c.state.account_channel });
       });
      } else {
       c.logerr(['did not receive idKey']);
      }
     }
    );
    if ( c.state.subscribeAccountTimeout ) {
     clearTimeout(c.state.subscribeAccountTimeout);
    }
    c.state.subscribeAccountTimeout = setTimeout(function() {
     c.subscribeAccount(cb);
    }, 24 * 60 * 60 * 1000);

    c.getBalance = function(type) {
     if ( c.state.account.balance[type] ) {
      return(c.state.account.balance[type]);
     }
    };
   };
 
   this.readAccount = function(acc) {
    var wal = acc.Wallets;
    if ( wal ) {
     c.state.account.wallets = wal;
     c.state.account.balance.btc = parseInt(wal.BTC.Balance.value_int, 10);
     c.state.account.balance.fiat = parseInt(wal[c.conf.currency].Balance.value_int, 10);
     c.state.account.login = acc.Login;
     c.state.account.fee = acc.Trade_Fee;
     c.state.account.rights = acc.Rights;
     c.state.account.volume = parseInt(acc.Monthly_Volume.value_int, 10);
    } else {
     c.logerr(['received invalid account update']);
     return;
    }
   };

   this.readWalletUpdate = function(wal) {
    var bal = c.state.account.balance;
    if ( wal && wal.op && wal.amount && wal.amount.currency ) {
     if ( wal.op === 'out' || wal.op === 'spent' || wal.op === 'withdraw' ) {
      if ( wal.amount.currency === c.conf.currency ) {
       bal.fiat = bal.fiat - parseInt(wal.amount.value_int, 10);
      } else if ( wal.amount.currency === 'BTC' ) {
       bal.btc = bal.btc - parseInt(wal.amount.value_int, 10);
      }
     } else if ( wal.op === 'in' || wal.op === 'earned' || wal.op === 'deposit' ) {
      if ( wal.amount.currency === c.conf.currency ) {
       bal.fiat = bal.fiat + parseInt(wal.amount.value_int, 10);
      } else if ( wal.amount.currency === 'BTC' ) {
       bal.btc = bal.btc + parseInt(wal.amount.value_int, 10);
      }
     }
    } else {
     c.logerr(['received invalid or unknown wallet update']);
     return;
    }
    if ( c.state.on.account ) {
     c.state.on.account(c.state.account,wal);
    }
   };

   this.getEngineLag = function(cb) {
    c.sendPrivateMessage(
     { call: c.conf.currencystr + '/order/lag' },
     function(res) {
      if ( res.result ) {
       if ( cb ) {
        cb(res.result);
       }
      }
     }
    );
   };
 
   this.getOrders = function(cb) {
    c.sendPrivateMessage({
     call: c.conf.currencystr + '/orders' },
     function(ret) {
      if ( ret && ret.result && Object.prototype.toString.call( ret.result ) === '[object Array]' ) {
       c.state.orders = ret.result;
       if ( cb ) {
        cb(ret.result);
       }
      } else {
       if ( cb ) {
        cb();
       }
      }
     }
    );
   };
 
   this.addOrder = function(order,cb) {
    var params = {
     type: order.type,
     amount_int: order.amount
    };
    if ( order.price ) {
     params.price_int = order.price;
    }
    c.sendPrivateMessage({
     call: c.conf.currencystr + '/order/add',
     params: params
    }, cb);
   };
 
   this.cancelOrder = function(order,cb) {
    c.sendPrivateMessage({
     call: c.conf.currencystr + '/order/cancel',
     params: {
      oid: order.oid
     }
    }, cb);
   };
  } 
 }

 // Get currency description and market depth via REST
 if ( c.conf.minode ) {
  this.getDepthREST = function(cb) {
   c.http.get(c.conf.depthurl, function(res) {
    var json = '';
    res.on('data', function(chunk) {
     json += chunk;
    });
    res.on('end', function() {
     var data;
     if ( json ) {
      data = c.parseJSON(json);
      cb(data);
     } else {
      c.logerr(["getDepthREST: HTTP GET returned null"]);
      cb(null);
     }
    });
    res.on('error', function(e) {
     c.logerr(["getDepthREST: failed HTTP GET:", e.message]);
     cb(null);
    });
   });
  };
  this.getCurrencyDescriptionREST = function(cb) {
   c.http.get(c.conf.currencydescurl, function(res) {
    var json = '';
    res.on('data', function(chunk) {
     json += chunk;
    });
    res.on('end', function(chunk) {
     var data;
     data = c.parseJSON(json);
     cb(data);
    });
    res.on('error', function(e) {
     c.logerr(["getCurrencyDescriptionREST: failed HTTP GET:", e.message]);
     cb(null);
    });
   });
  };
 } else {
  this.getDepthREST = function(cb) {
   if ( c.conf.debug ) {
    c.logger(['getting depth from', url]);
   }
   $.ajax({
    dataType: 'json',
    url: c.conf.depthurl,
    success: cb
   });
  };
  this.getCurrencyDescriptionREST = function(cb) {
   if ( c.conf.debug ) {
    c.logger(['getting currency description from', url]);
   }
   $.ajax({
    dataType: 'json',
    url: c.conf.currencydescurl,
    success: cb
   });
  };
 }

 // Parse inbound JSON safely
 this.parseJSON = function(str) {
  var m;
  try {
   m = JSON.parse(str);
   return(m);
  } catch (er) {
   c.logerr(['failed to parse inbound JSON', str]);
  }
 };

 // Logging methods
 this.makeLog = function(msg,err) {
  var log = {};
  log.ts = new Date().getTime();
  log.source = c.name;
  if ( Object.prototype.toString.call(msg) === '[object Array]' ) {
   log.message = msg.join(' ');
  } else {
   log.message = msg;
  }
  if ( err ) {
   log.error = true;
  } else {
   log.error = false;
  }
  if ( c.state.on.log ) {
   c.state.on.log(log);
  } else {
   console.log(c.epochToDateTimeStr(log.ts) + ' ' + log.source + ' ' + log.message);
  }
 };

 this.logerr = function(log) {
  c.makeLog(log,true);
 };
 this.logger = function(log) {
  c.makeLog(log);
 };

 // Timestamp formatting for log output
 this.epochToDateTimeStr = function(e) {
  var ct = new Date();
  ct.setTime(e);
  var dt = {};
  dt.year = ct.getUTCFullYear();
  dt.month = ct.getUTCMonth();
  dt.day = ct.getUTCDate();
  dt.hour = ct.getUTCHours();
  dt.minute = ct.getUTCMinutes();
  dt.second = ct.getSeconds();
  dt.month++;
  if(dt.month <10) {
   dt.month = "0" + dt.month;
  }
  if(dt.day <10) {
   dt.day = "0" + dt.day;
  }
  if(dt.hour <10) {
   dt.hour = "0" + dt.hour;
  }
  if(dt.minute <10) {
   dt.minute = "0" + dt.minute;
  }
  if(dt.second <10) {
   dt.second = "0" + dt.second;
  }
  var dts = dt.year + '-' + dt.month + '-' + dt.day + ' ' + dt.hour + ':' + dt.minute + ':' + dt.second;
  return(dts);
 };

 return(c);
}
if ( typeof exports == 'undefined' ) {
 var exports = {};
}
exports.GoxClient = GoxClient;
