goxsocketjs
===

QSN MtGox Javascript Websocket Client for Node.js and HTML5 Browsers.

This client provides a high level account, market data, and order abstraction to the MtGox exchange. It implements low latency public and private API methods via native Websocket messaging, using REST only where necessary.

High level methods within the browser require jQuery to retrieve data via Ajax for the loading of depth and currency metadata.
https://github.com/jquery/jquery

Private methods require a MtGox API key with sufficient privileges.

A browser using private methods will also require the jsSHA library. https://github.com/Caligatio/jsSHA

Node.js support requires the Minode library (https://github.com/billywhizz/minode).

For private methods using Node.js, btoa is also required (installable via npm).

Copyright (c) 2013 Quantitative Signals Network. https://www.quantsig.net

Distributed under the terms of the MIT license (below).

Low Level Methods
===

The low level API provides basic I/O including signed private messages. Setting lowlevel to true will disable all high level methods.

Standard Configuration
---

	var config = {
		lowlevel: true
	};

*Optional* Multicurrency market data (available in the low level API). Must be set prior to calling `connect()`.

	config.connstr = 'wss://websocket.mtgox.com/mtgox?Currency=USD,EUR,CNY';

API key and secret are required for private methods.

	config.apikey = 'API Key ID';
	config.apisecret = 'API Secret';

*Optional* Bulk loading event handlers. All handlers specified via the `on` method can be configured using `config.on`. It must be prepared before creating a new instance.

	config.on = {
		log:   function(log) { console.log(log); },
		open:  function() { console.log('connected'); },
		close: function() { console.log('closed'); }
	};

Node.js Configuration
---

Install btoa via npm or otherwise.

	npm install btoa;

Clone Minode. It provides a fast and compatible Websocket implementation within Node.js.

	git clone https://github.com/billywhizz/minode.git

Specify Minode location. It will be auto-required by the client.

	config.minode = "./minode";

Load GoxClient library.

	require("./mtgox").GoxClient;

See `example/node.js` for a simple node.js client using the high level api.

Client Management
---

Create a new instance of the MtGox Client.

	var gox = new GoxClient(config);

The `on` method assigns handlers to specific events after instantiation. Here we use the `on` method to assign an `open` event handler.

	gox.on('open', function() {
		console.log('connected');
	});

To configure the `log` emitter, create and assign a handler, and all log messages will be directed to the handler. This will also disable internal console logging by the client.

	gox.on('log', function(log) {
		console.log(log);
	});

The `close` event executes when the browser closes a socket. Reconnection should utilize a setTimeout to prevent potentially rapid reconnections overwhelming the application or exchange, which may result in a ban.

	gox.on('close', function() {
		setTimeout(function() {
			gox.connect();
		}, 30000);
	});

The `error` event may require an alert to the user. Do not set a reconnection from the error event as the close event will also emit when an error occurs.

	gox.on('error', function(err) {
		console.log('connection error', err);
	});

All inbound messages will arrive at the `message` event in raw format when the low level API is in use. However, replies to private messages sent with a callback will arrive only at their supplied callback.

	gox.on('message', function(m) {
		console.log(m);
	});

Connect a configured client. A callback may be provided, which will set the `open` event handler to the callback.

	gox.connect(function() {
		console.log('connected');
	});

Client State and Status
---

Return internal state object containing account, market data, trade data, client status, handlers, and running parameters.

	gox.getState();

Exchange Engine
---

Get trading engine lag.

	gox.getEngineLag(function(lag) {
		console.log('received lag', lag);
	});

Unauthenticated Messages
---

Send a raw or unauthenticated message.

	gox.sendMessage({ op: 'mtgox.subscribe', type: 'ticker' });

Private (Signed) Messages
---

Private messages are available when `config.apikey` and `config.apisecret` are set. The sendPrivateMessage method signs and encodes a MtGox call message. Any reply will arrive at the provided callback if supplied.

	gox.sendPrivateMessage(
		{ call: 'BTCUSD/info' },
		function(ret) {
			console.log(ret);
		}
	);

High Level Methods
===

The high level API handles state, message switching, account status, market data, and order I/O. All low level methods are available to the high level API.

Note that the high level API supports only one fiat currency per instance. To receive data for multiple currencies, either create an instance for each desired currency or use the low level API. A trading instance must use a currency defined for the MtGox trading account.

Configuration
---

Complete your low level setup using the below config and desired handlers. Then continue using the high level methods. Note that the lowlevel option must either be absent or false.

	var config = {
		apikey: 'API Key ID',
		apisecret: 'API Secret'
	};

Default fiat currency is USD.

	config.currency = 'USD';

Depth cleanup occurs automatically following a delay on tick events. Setting depthcleanup (milliseconds) lower or higher will adjust the delay prior to executing the depth cleanup event. Note that accurate depth cannot be guaranteed because of limitations within the MtGox API.

	config.depthcleanup = 1000;

To cope with depth corruption, we refresh the depth table periodically. When configured, refreshdepth will download market depth at the specified interval in minutes from the REST API.

	config.refreshdepth = 15;

Account methods
---

Set up `account` handler. It will be called for every account update as well as the initial account loading.

	gox.on('account', function(acct) {
		console.log('received account update', acct);
	});

Subscribe to account channel. Account balances are maintained and will be provided in the `acct` argument. External reconciliation may wish to use the `orig` argument and handle the MtGox messages directly. Note that this method will self re-invoke in 24 hours via `setTimeout()` as the key it must use will expire and thus requires refreshing. Any changes to the account handler will not be affected by re-invocation.

	// Override account handler with callback argument
	gox.subscribeAccount(function(acct,orig) {
		console.log('account update', acct, 'orig', orig);
	});

Return current balance of BTC or fiat. Available after `subscribeAccount()` receives the first account message.

	gox.getBalance('btc');
	gox.getBalance('fiat');

Singularly request account data. Arguments passed to the callback are loaded account data and original response from the exchange. This method should not be necessary if `subscribeAccount()` is used and the exchange is healthy.

	gox.getAccount(function(acct,orig) {
		console.log('account', acct, 'orig', orig);
	});

Divisors and order size.
---

Internally and via the API, BTC units are maintained as Satoshi values (integer), while Fiat units are a fixed multiple unique for each currency (also integer). It may be necessary to convert from Satoshi/Fiat values to human readable BTC/Fiat values (or vice-versa) for presentation. The following methods provide the divisors necessary for this conversion.

BTC unit divisor.

	gox.btcDivisor();

Fiat unit divisor.

	gox.fiatDivisor();

MtGox has a minimum order size requirement. The minimum order size can be retrieved in satoshi.

	gox.minimumOrder();

Market data methods
---

All summary and query values returned are parsed integers. The MtGox websocket feed automatically subscribes all clients to the depth, ticker, and trades channels. Client initialization requires a `subscribeDepth()` call in order to download market depth from the exchange via the REST API.

Receive `ticker` events.

	gox.on('ticker', function(summary,raw) {
		console.log('ticker event', summary);
	});

Receive `trades` events. Note that when `subscribeAccount()` is used, there will be duplicate trade messages for this account sent by the exchange.

	gox.on('trade', function(summary,raw) {
		console.log('trade event', summary);
	});

Receive `depth` events.

	gox.on('depth', function(summary,raw) {
		console.log('depth event', summary);
	});

Download and subscribe to market depth and enable depth queries. Subscribing to depth also subscribes the instance to 'ticker' and 'trades' which are used to consolidate market depth.

	gox.subscribeDepth(function(depth) {
		console.log('subscribeDepth', depth);
	});

Query depth table for best price and volume.

	gox.getPrice('ask'); // long
	gox.getPrice('bid'); // short

Query depth table for long prices and volumes.

	gox.getPrices('ask'); // long
	gox.getPrices('bid'); // short

Query ticker for current rate (approximate midpoint within the spread).

	gox.getRate();

Order management methods
---

Like the data API, all price and volume fields are integers.

Request open orders from the exchange.

	gox.getOrders(function(orders) {
		console.log('orders', orders);
	});

Set up a new limit order. Valid types are bid or ask. All units are integers.

	var order = {
		type: 'bid',
		price: 100000,
		amount: 100000
	};

Set up a new market order.

	var order = {
		type: 'ask',
		amount: 100000
	};

Submit order to exchange.

	gox.addOrder(order, function(ret) {
		console.log('addOrder', ret);
	});
 
Cancel an order.

	gox.addOrder(order, function(o) {
		// The required `id` parameter will be created within the order object. It can be passed directly to cancel.
		gox.cancelOrder(order, function(ret) {
			console.log('order cancel', ret);
		});
		console.log('addOrder', ret);
	});

License
===

Copyright (c) 2013 Quantitative Signals Network <support@quantsig.net>

The MIT License (MIT)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
