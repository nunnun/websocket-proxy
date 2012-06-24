var http = require('http'), WebSocketClient = require('websocket').client, uuid = require('node-uuid'),opts = require('opts');
var wslib = require('../../libs/websocket-proxy-lib');

opts.parse([{
	'short':'h',
	'long':'host',
	'value': true,
	'description':'WebSocket Proxy Server Host',
	'required':false
},{
	'short':'p',
	'long':'port',
	'value': true,
	'description':'WebSocket Proxy Server Port',
	'required':false	
}],true);

var listen_ports = [ 8000, 8001, 8002, 8003, 8004, 8005, 8006, 8007 ];
var proxy_server = {
		host:(opts.get('h') || '127.0.0.1'),
		port:opts.get('p') || '8080',
};

var responseArray = {};

var client = new WebSocketClient();
client.on('connectFailed', function(error) {
	console.log('Connect Error: ' + error.toString());
	setTimeout(connectToProxy,5000);
});

var ws_connection;

client.on('connect', function(connection) {
	ws_connection = connection;
	console.log('WebSocket client connected');
	ws_connection.on('error', function(error) {
		console.log("Connection Error: " + error.toString());
	});
	ws_connection.on('close', function() {
		console.log('echo-protocol Connection Closed');
		var reconnect = function(){
			if (ws_connection.state == 'closed') {
				connectToProxy();
				setTimeout(reconnect, 1500);
			}
		};
		reconnect();
	});
	ws_connection.on('message', function(message) {
		if (message.type === 'utf8') {
			var wsResponse = JSON.parse(message.utf8Data);
			var httpResponse = responseArray[wsResponse.id];
			if (wsResponse.end == false) {
				httpResponse.writeHead(wsResponse.statusCode,
						wsResponse.headers);
			} else {
				httpResponse.end();
				setTimeout(function() {
					delete responseArray[wsResponse.id];
				}, 10);
			}
		} else if (message.type === 'binary') {
			var chunk = wslib.unloadWsChunk(message.binaryData);
			var res = responseArray[chunk.id];
			res.write(chunk.payload);
		}
	});
});

function connectToProxy(){
	client.connect('ws://' + proxy_server.host + ':'+proxy_server.port+'/', 'proxy');
}

connectToProxy();

function startProxy() {
	if (ws_connection == undefined) {
		// WebSocketの接続を待つ
		setTimeout(startProxy, 100);
	} else {
		console.log("Connection to " + proxy_server.host + ":"+proxy_server.port);
		for ( var i in listen_ports) {
			http.createServer(function(request, response) {
				sendRequest(request, response, listen_ports[i]);
			}).listen(listen_ports[i]);
		}
		console.log('Proxy started listening on following ports:'
				+ listen_ports.join());
	}
}

startProxy();

function sendRequest(request, response, port) {
	if (ws_connection != undefined) {
		if (ws_connection.connected) {
			var id = uuid.v4();
			responseArray[id] = response;
			var wsRequest = {
					id : id,
					method : request.method,
					url : request.url,
					headers : request.headers,
					end:false,
					data:''
				};
			ws_connection.sendUTF(JSON.stringify(wsRequest, true));
			console.log('Port:'+port+", URL:"+request.url);
			// Send a payload only if the request method is POST
			if(request.method === 'POST'){
				request.on('data', function(chunk) {
					ws_connection.sendBytes(wslib.loadWsChunk(id, chunk));
				});
				request.on('end', function() {
					ws_connection.sendUTF(JSON.stringify({
						id:id,
						end:true
					}, true));
				});
			}
			
		}
	}
}
