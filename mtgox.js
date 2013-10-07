/*jshint globalstrict: true*/
/*jshint browser: true*/
"use strict";
function GoxClient(conf) {
 var c = this;
 var depth, ticker;
 c.state = {
  depth: { asks: {}, bids: {} },
  ticker: { bid: 0, ask: 0 },
  last: { price: 0, volume: 0 },
  trades: [],
  orders: [],
  pending: {},
  account: { balance: {} },
  connected: false,
  on: {},
  btcdivisor: 100000000,
  inputMessages: 0,
  outputMessages: 0,
 };
 c.state.nonce = (new Date()).getTime() * 1000;

 if ( conf ) {
  c.conf = conf;
 } else {
  c.conf = {};
 }

 this.getState = function() {
  return(c.state);
 };

 if ( c.conf.lowlevel ) {
  c.conf.lowlevel = true;
 }

 if ( ! c.conf.depthcleanup ) {
  c.conf.depthcleanup = 1000;
 }

 if ( ! c.conf.currency ) {
  c.conf.currency = 'USD';
 }
 c.conf.currencystr = 'BTC' + c.conf.currency;

 if ( c.conf.lowlevel && ! c.conf.connstr ) {
  c.conf.connstr = 'wss://websocket.mtgox.com/mtgox?Currency=' + c.conf.currency;
 } else if ( ! c.conf.connstr && ! c.conf.lowlevel ) {
  c.conf.connstr = 'wss://websocket.mtgox.com/mtgox?Currency=' + c.conf.currency;
 }

 if ( c.conf.on ) {
  c.state.on = c.conf.on;
 }

 depth = c.state.depth;
 ticker = c.state.ticker;

 //Low level methods
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
  return(c.state.btcdivisor * .01);
 };

 this.sendMessage = function(msg) {
  var str = JSON.stringify(msg);
  c.socket.send(str);
  c.state.outputMessages++;
 };

 if ( c.conf.apikey && c.conf.apisecret ) {
  this.sendPrivateMessage = function(msg,cb) {
   var nonce, rid, keystr, req, reqstr, reqlist, sha, reqstr, sign, str;
   var bytes = [];
   c.state.nonce++;
   nonce = c.state.nonce;
   rid = c.hasher(nonce.toString());
   msg.id = rid;
   msg.nonce = nonce;

   if ( ! msg.params ) {
    msg.params = {};
   }
   str = JSON.stringify(msg);

   sha = new jsSHA(str,'TEXT');
   keystr = c.conf.apikey.split('-').join('');
   sign = sha.getHMAC(c.conf.apisecret, 'B64', 'SHA-512', 'B64');
   bytes = atob(sign);
   reqlist = [c.hex2a(keystr), bytes, str];
   reqstr = btoa(reqlist.join(''));

   req = {
    op: 'call',
    id: rid,
    call: reqstr,
    context: 'mtgox.com'
   };

   if ( cb ) {
    c.state.pending[rid] = cb;
   }

   c.sendMessage(req);
   return;
  };

  // Extract bytes from HEX API Key
  this.hex2a = function(hex) {
   var str = '';
   for (var i = 0; i < hex.length; i += 2) 
    str += String.fromCharCode(parseInt(hex.substr(i, 2), 16)); 
   return str;
  };

  // Return sha256 hex string
  this.hasher = function(string) {
   var sha = new jsSHA(string, 'TEXT');
   return(sha.getHash('SHA-256','HEX'));
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
  }
  c.logger(['unknown result message', JSON.stringify(message)]);
 };

 this.connect = function(cb) {
  var messageSwitch, connstr, onopen;

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
    var message = c.parseJSON(msg.data);
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
  var sock = new WebSocket(c.conf.connstr);
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
   c.logger(['socket error', JSON.stringify(err)]);
   c.state.connected = false;
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
   c.getDepthAjax(function(d) {
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
    return;
   }
   switch(msg.success) {
    case true:
     c.logger(['success message', msg.message]);
     return;
    break;
    case false:
     c.logger(['error message', JSON.stringify(msg)]);
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
    }
   }
   c.logger(['mtgox unknown private message', JSON.stringify(message)]);
  };
 
  this.tickerMessage = function(m) {
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
   c.getCurrencyDescription(function(d) {
    if ( ! c.state.price_divisor ) {
     if ( ! c.state.curdesctimeout ) {
      c.state.curdesctimeout = 30000;
     } else {
      if ( c.state.curdesctimeout < 300000 ) {
       c.state.curdesctimeout = c.state.curdesctimeout + 30000;
      }
     }
     c.logger(['failed to get currency description from exchange']);
     setTimeout(function() {c.loadCurrencyDescription()}, c.state.curdesctimeout);
    }
    if ( cb ) {
     cb();
    }
   });
  };
 
  this.getCurrencyDescription = function(cb) {
   c.getCurrencyDescriptionAjax(function(desc) {
    if ( desc.return && desc.return.decimals ) {
     c.state.ticker_channel = desc.return.ticker_channel;
     c.state.depth_channel = desc.return.depth_channel;
     c.state.price_divisor = Math.pow(10, parseInt(desc.return.decimals, 10));
     if ( c.conf.debug ) {
      c.logger(['price divisor set to ', c.state.price_divisor]);
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
   for ( var i = 0; i < blen; i++ ) {
    price = parseInt(bdata.bids[i].price_int, 10);
    volume = parseInt(bdata.bids[i].amount_int, 10);
    bids[price] = volume;
   }
   return;
  }

  this.refreshDepth = function() {
   if ( ! c.state.refreshdepthtimeout && c.conf.refreshdepth ) {
    c.state.refreshdepthtimeout = setTimeout(function() {
     c.getDepthAjax(function(d) {
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
      var res = info.result;
      var wal = res.Wallets;
      if ( res ) {
       c.state.account.balance.btc = parseInt(wal.BTC.Balance.value_int, 10);
       c.state.account.balance.fiat = parseInt(wal[c.conf.currency].Balance.value_int, 10);
       c.state.account.wallets = wal;
       c.state.account.rights = res.Rights;
       c.state.account.volume = parseInt(res.Monthly_Volume.value_int, 10);
      }
      if ( cb ) {
       cb(c.state.account,info);
      }
     }
    );
   };

   this.subscribeAccount = function(cb) {
    c.getAccount(function(account, info) {
     c.sendPrivateMessage(
      { call: c.conf.currencystr + '/idkey' },
      function(res) {
       if ( res.result ) {
        c.logger('subscribing to account feed');
        c.sendPrivateMessage(
         { op: 'mtgox.subscribe', key: res.result },
         function(r) {
          c.logger(['accountsub', JSON.stringify(r)])
         }
        );
        if ( cb ) {
         cb(res.result);
        }
       }
      }
     );
    });
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
 
   this.getBalance = function(type) {
    return(c.state.account.balance[type]);
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

 // Get market depth via ajax
 this.getDepthAjax = function(cb) {
  var url = 'http://data.mtgox.com/api/1/' + c.conf.currencystr + '/depth/fetch';
  if ( c.conf.debug ) {
   c.logger(['getting depth from', url]);
  }
  $.ajax({
   dataType: 'json',
   url: url,
   success: cb
  });
 }

 // Get currency description
 this.getCurrencyDescriptionAjax = function(cb) {
  var url = 'http://data.mtgox.com/api/1/generic/currency?currency=' + c.conf.currency;
  if ( c.conf.debug ) {
   c.logger(['getting currency description from', url]);
  }
  $.ajax({
   dataType: 'json',
   url: url,
   success: cb
  });
 }

 // Parse inbound JSON safely
 this.parseJSON = function(str) {
  var m;
  try {
   m = JSON.parse(str);
   return(m);
  } catch (er) {
   console.trace();
   c.logger(['failed to parse JSON', str]);
  }
 };

 this.makelog = function(msg,err) {
  var log = {};
  var cons;
  log.ts = new Date().getTime();
  log.tstring = epochToDateTimeStr(log.ts);
  log.source = 'mtgox';

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
   cons = log.tstring + ' ' + log.source + ' ' + log.message;
   console.log(cons);
  }
 };

 this.logerr = function(log) {
  c.makelog(log,true);
 };
 this.logger = function(log) {
  c.makelog(log);
 };

 return(c);
}
if ( typeof exports == 'undefined' ) {
 var exports = this.mtgoxwebsocket = {};
}
exports.GoxClient = GoxClient;
