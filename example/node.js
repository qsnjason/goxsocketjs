// Load QSN MtGox Client
var GoxClient, config, gox;

GoxClient = require("../mtgox").GoxClient;

// Prepare config
config = {
 debug: true,
 minode: './minode',
 // Account access via API key
 //apikey: 'API KEY',
 //apisecret: 'API Secret',
 on: {
  open: function() {
   console.log('connected');
  },
  close: function() {
   console.log('closed');
   setTimeout(function() {
    gox.connect();
   }, 5000);
  }
 }
};

// Instance.
gox = new GoxClient(config);

function connect() {
 gox.connect(function() {
  var repl = require("repl").start({
   prompt: "goxcon> ",
   input: process.stdin,
   output: process.stdout
  });
  repl.context.gox = gox;
 });
}

connect();

// Add depth interface
//gox.subscribeDepth();

