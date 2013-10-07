goxsocketjs
===========

Javascript MtGox V1 Websocket API client by Jason Ihde <jason@quantsig.net>. 

This library implements both public and private API messaging methods in a pure websocket, using REST methods only where necessary. It also provides a limited high level depth, account, and order abstraction for simplified trading access.

Private methods require a MtGox API key with sufficient privileges.

This library relies on jQuery to retrieve data via Ajax methods where unavailable via the websocket.
https://github.com/jquery/jquery

Private methods also require the jsSHA library available at:
https://github.com/Caligatio/jsSHA.git

Low Level Methods
-----------------

The low level API provides basic I/O including authenticated access. Setting lowlevel to
true will disable all high level methods.

Standard Usage
--------------

	var config = {
		lowlevel: true
	};

Optional multicurrency market data (only available in the low level API). Must be set prior to calling `connect()`.

	config.connstr = 'wss://websocket.mtgox.com/mtgox?Currency=USD,EUR,JPY';

API key and secret are equired for private methods.

	config.apikey = 'API Key ID';
	config.apisecret = 'API Secret';

Create a new instance of the Mt. Gox Client.

	var gox = new GoxClient(config);

The on method assigns callbacks executed for specific events. OnOpen can be set using the on method or passed as a function argument to connect().

	gox.on('open', function() {
		console.log('connected');
	});

The on close event fires immediately upon a close event, reconnections should utilize a setTimeout to prevent rapid reconnections overwhelming the application or exchange.

	gox.on('close', function() {
		setTimeout(function() {
			gox.connect();
		}, 30000);
	});

The on error event should either stop and alert the user or set a reconnection timeout.

	gox.on('error', function(err) {
		console.log('error', err);
	});

By default, inbound messages will arrive at onmessage in raw format when the low level API is in use. However, replies to authenticated messages sent with a callback will arrive at their supplied callback.

	gox.on('message', function(m) {
		console.log(m);
	});

Connect a configured client. A callback may be used to initialize the onconnect or pre-supplied as shown above.

	gox.connect(function() {
		console.log('connected');
	});

Unauthenticated Messages
------------------------

For unauthenticated messages or to send raw messages, use sendMessage.

	gox.sendMessage({ op: 'mtgox.subscribe', type: 'ticker' });

Authenticated Messages
======================

Authenticated messages are available when apikey and apisecret are configured. The sendPrivateMessage method signs and encodes a call message and maps any reply to the assigned callback if supplied.

	gox.sendPrivateMessage(
		{ call: 'BTCUSD/info' },
		function(ret) {
			console.log(ret);
		}
	);

High Level Methods
------------------

The high level API handles message switching, state, market data, and order management. All low level methods are available to the high level API.

Note that the high level API can support only one currency per instance. To receive data for multiple currencies, either create an instance for each desired currency or use the low level API. A trading instance must use the currency defined for the MtGox trading account.

Configuration
-------------

Complete your low level setup using the below config and desired callbacks. Then continue using the high level methods. Note that the lowlevel option must either be absent or set false.

	var config = {
		apikey: 'API Key ID',
		apisecret: 'API Secret'
	};

Currency is required for the high level API. Default is USD.

	config.currency = 'USD';

Depth cleanup operations occur automatically following tick events. Setting depthcleanup lower or higher will adjust the delay prior to executing the depth cleanup event. Note that accurate depth cannot be guaranteed because of limitations within the MtGox API.

	config.depthcleanup = 1000;

Depth refresh, when configured, will automatically sync market depth at the specified intervaldefined in minutes.

	config.refreshdepth = 15;

Engine methods
--------------

Get trading engine lag.

	gox.getEngineLag(function(lag) {
		console.log('received lag', lag);
	});

Account methods
---------------

Set up onaccount callback if desired.

	gox.on('account', function(acct) {
		console.log('received account update', acct);
	});

Subscribe to account updates and provide query interface to current data.

	gox.subscribeAccount(function(acct) {
		console.log('received account', acct);
	});

Submit an account information request. The objects in the callback are parsed summary data and  the original response.

	gox.getAccountInfo(function(summary,orig) {
		console.log('account summary', summary, 'original', orig);
	});
  
Return cached current balance of BTC and fiat. They are available after receipt of getAccountInfo or subscribeAccount.

	var btc = gox.getBalance('btc');
	var fiat = gox.getBalance('fiat');
	console.log('balances', 'btc', btc, 'fiat', fiat);

Market data methods
-------------------

All summary and query values returned are parsed integers. The MtGox websocket feed automatically subscribes all clients to the depth, ticker, and trades feeds. Client initialization requires a subscribeDepth call in order to load the depth from the exchange.

Set up depth emitter.

	gox.on('depth', function(summary,raw) {
		console.log('depth event', summary);
	});

Download and subscribe to market depth and enable depth queries. Subscribing to depth also subscribes the instance to 'ticker' and 'trades' which are used to consolidate market depth.

	gox.subscribeDepth(function(depth) {
		console.log('subscribeDepth', depth);
	});

Query depth for best price and volume. Available after subscription to depth is complete.

	var long = gox.getPrice('bid');
	var short = gox.getPrice('ask');
	console.log('long ' + long.price + '/' + long.volume, ', short ' + short.price + '/' + short.volume);

Set up trades emitter.

	gox.on('trade', function(summary,raw) {
		console.log('trade event', summary);
	});

Set up ticker emitter.

	gox.on('ticker', function(summary,raw) {
		console.log('ticker event', summary);
	});

Order management methods
------------------------

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

License
=======

This software is distributed under the MIT License.

The MIT License (MIT)

Copyright (c) 2013 Jason Ihde (Quantitative Signals Network) <jason@quantsig.net>

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

