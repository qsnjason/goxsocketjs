goxsocketjs
===

Javascript MtGox Websocket API V1 client by Quantitative Signals Network <support@quantsig.net>. 

This client provides a high level depth, account, and order abstraction. It implements low latency public and private API methods via Websocket, using REST only where necessary within HTML5 browsers.

The high level methods available in this library require jQuery to retrieve data via Ajax for the loading of depth and currency metadata.
https://github.com/jquery/jquery

Private methods require a MtGox API key with sufficient privileges (account/trade) as well as the jsSHA library.
https://github.com/Caligatio/jsSHA.git

Low Level Methods
===

The low level API provides basic I/O including authenticated access. Setting lowlevel to true will disable all high level methods.

Standard Usage
---

	var config = {
		lowlevel: true
	};

*Optional* Multicurrency market data (available in the low level API). Must be set prior to calling `connect()`.

	config.connstr = 'wss://websocket.mtgox.com/mtgox?Currency=USD,EUR,JPY';

API key and secret are required for private methods.

	config.apikey = 'API Key ID';
	config.apisecret = 'API Secret';

Create a new instance of the Mt. Gox Client.

	var gox = new GoxClient(config);

The on method assigns callbacks executed for specific events. The onOpen can be set using the on method or passed as a function argument to `connect()`.

	gox.on('open', function() {
		console.log('connected');
	});

To enable the log emitter, create an onLog handler, and all log messages will be directed to the handler.

	gox.on('log', function(log) {
		console.log(log);
	});

The onClose event fires immediately upon a close event, reconnects should utilize a setTimeout to prevent rapid reconnections overwhelming the application or exchange.

	gox.on('close', function() {
		setTimeout(function() {
			gox.connect();
		}, 30000);
	});

The onError event should either stop and alert the user or set a reconnection timeout.

	gox.on('error', function(err) {
		console.log('error', err);
	});

Inbound messages will arrive at onMessage in raw format when the low level API is in use. However, replies to private messages sent with a callback will arrive at their supplied callback.

	gox.on('message', function(m) {
		console.log(m);
	});

Connect a configured client. A callback may be used to initialize the onConnect or pre-supplied as shown above.

	gox.connect(function() {
		console.log('connected');
	});

Unauthenticated Messages
---

Send a raw or unauthenticated message.

	gox.sendMessage({ op: 'mtgox.subscribe', type: 'ticker' });

Authenticated Messages
---

Authenticated messages are available when apikey and apisecret are configured. The sendPrivateMessage method signs and encodes a MtGox call message. Any reply will arrive at the assigned callback if supplied.

	gox.sendPrivateMessage(
		{ call: 'BTCUSD/info' },
		function(ret) {
			console.log(ret);
		}
	);

High Level Methods
===

The high level API handles message switching, state, market data, and order management. All low level methods are available to the high level API.

Note that the high level API supports only one currency per instance. To receive data for multiple currencies, either create an instance for each desired currency or use the low level API. A trading instance must use the currency defined for the MtGox trading account.

Configuration
---

Complete your low level setup using the below config and desired callbacks. Then continue using the high level methods. Note that the lowlevel option must either be absent or set false.

	var config = {
		apikey: 'API Key ID',
		apisecret: 'API Secret'
	};

Default Currency is USD.

	config.currency = 'USD';

Depth cleanup occurs automatically following a delay on tick events. Setting depthcleanup (milliseconds) lower or higher will adjust the delay prior to executing the depth cleanup event. Note that accurate depth cannot be guaranteed because of limitations within the MtGox API.

	config.depthcleanup = 1000;

To cope with depth corruption, we refresh the depth table periodically. When configured, refreshdepth will download market depth at the specified interval in minutes from the REST API.

	config.refreshdepth = 15;

Account methods
---

Set up onAccount callback if desired.

	gox.on('account', function(acct) {
		console.log('received account update', acct);
	});

Subscribe to account updates and provide query interface to current data.

	gox.subscribeAccount(function(acct) {
		console.log('received account', acct);
	});

Submit an account information request. The objects in the callback are parsed summary data and the original response.

	gox.getAccountInfo(function(summary,orig) {
		console.log('account summary', summary, 'original', orig);
	});

Return cached current balance of BTC and fiat. They are available after receipt of `getAccountInfo()` or `subscribeAccount()`.

	var btc = gox.getBalance('btc');
	var fiat = gox.getBalance('fiat');
	console.log('balances', 'btc', btc, 'fiat', fiat);

Divisors and order size.
---

Internally and via the API, BTC units are maintained as satoshi values (int). It may be necessary to convert from satoshi values to human readable BTC values (or vice-versa) for presentation. The following two methods provide the divisors necessary for this conversion.

BTC unit divisor.

	gox.btcDivisor();

Fiat unit divisor.

	gox.fiatDivisor();

MtGox has a minimum order size requirement. The minimum order size can be retrieved in satoshi.

	gox.minimumOrder();

Market data methods
---

All summary and query values returned are parsed integers. The MtGox websocket feed automatically subscribes all clients to the depth, ticker, and trades feeds. Client initialization requires a `subscribeDepth()` call in order to load the depth from the exchange.

Set up ticker emitter.

	gox.on('ticker', function(summary,raw) {
		console.log('ticker event', summary);
	});

Set up trades emitter.

	gox.on('trade', function(summary,raw) {
		console.log('trade event', summary);
	});

Set up depth emitter.

	gox.on('depth', function(summary,raw) {
		console.log('depth event', summary);
	});

Download and subscribe to market depth and enable depth queries below. Subscribing to depth also subscribes the instance to 'ticker' and 'trades' which are used to consolidate market depth.

	gox.subscribeDepth(function(depth) {
		console.log('subscribeDepth', depth);
	});

Query depth for best price and volume.

	gox.getPrice('ask');

Query depth for long prices and volumes.

	gox.getPrices('bid');

Query depth for current approximate rate.

	gox.getRate();

Order management methods
---

Like the data API, all price and volume fields are integers.

Request open orders.

	gox.getOrders(function(orders) {
		console.log('orders', orders);
	});

Set up a new limit order. Valid types are bid or ask.

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

	gox.cancelOrder(order, function(ret) {
		console.log('order cancel', ret);
	});

Engine methods
---

Get trading engine lag.

	gox.getEngineLag(function(lag) {
		console.log('received lag', lag);
	});

License
=======

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

