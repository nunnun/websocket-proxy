var http = require('http'), https = require('https'), WebSocketClient = require('websocket').client,opts = require('opts'), url = require('url'), net = require('net');
var wslib = require('../../libs/websocket-proxy-lib');

// TODO 受信時にContent-Lengthを確認して送受信を終了させる
// TODO 8008番で待ち受けてproxy.pacを配布する
// TODO HTTPS対応

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
var seq = 0;

var client = new WebSocketClient();
client.on('connectFailed', function(error) {
	console.log('Connect Error: ' + error.toString());
	setTimeout(connectToProxy,5000);
});

var ws_connection;

function getRequestNumber(){
	if (seq == 0xffff){
		seq = 1;
	}else{
		seq++;
	}
	return seq;
}


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
			if (wsResponse.method != 'CONNECT'){
				var httpResponse = responseArray[wsResponse.id];
					httpResponse.writeHead(wsResponse.statusCode,
							wsResponse.headers);
			}else{
				var cltSocket = responseArray[wsResponse.id];
				cltSocket.write('HTTP/1.1 200 Connection Established\r\n' +
	                    'Proxy-agent: Node-Proxy\r\n' +
	            '\r\n');
			}
		} else if (message.type === 'binary') {
			var wschunk = wslib.unloadWsChunk(message.binaryData);
			if(wschunk.id in responseArray){
				var res = responseArray[wschunk.id];
				if(wschunk.opcode == 1){
					res.write(wschunk.payload);
				}else if(wschunk.opcode == 8){
					res.end();
					delete responseArray[wschunk.id];
				}else if(wschunk.opcode == 2){
					var res = responseArray[wschunk.id];
					res.write(wschunk.payload);
				}else if(wschunk.opcode == 9){
					var res = responseArray[wschunk.id];
					try{
						res.end();
					}catch(e){
						console.log(e);
					}
					delete responseArray[wschunk.id];
				}
			}else{
				console.log('Error: Response is destroyed even before last payload has arrived.' + wschunk.id+ ":" + wschunk.opcode);
			}
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
			_setupHttpServer(http,listen_ports[i]);
		}
		console.log('Proxy started listening on following ports:'
				+ listen_ports.join());
	}
}

startProxy();

function _setupHttpServer(http,port){
	var httpserver = http.createServer(function(request, response) {
		sendRequest(request, response, port);
	});
	httpserver.on('connect',function(req, cltSocket, head){
		sendTLSRequest(req, cltSocket, head, port);
	});
	httpserver.listen(port);
};

function sendTLSRequest(req, cltSocket, head, port){
	if (ws_connection != undefined) {
		if (ws_connection.connected) {
			var id = getRequestNumber();
			var seq = 1;
			responseArray[id] = cltSocket;
			var wsRequest = {
					id : id,
					method : req.method,
					url : req.url,
					headers : req.headers,
					data:''
				};
			ws_connection.sendUTF(JSON.stringify(wsRequest, true));
			cltSocket.on('data',function(chunk){
				seq++;
				ws_connection.sendBytes(wslib.loadWsChunk(id, chunk,2,seq));
			});
			cltSocket.on('end',function(){
				console.log('client on end!');
				seq++;
				ws_connection.sendBytes(wslib.loadWsChunk(id, '',9,seq));
			});
			console.log('Port:'+port+", URL:"+req.url);
			if(0 == head.length){
				seq++;
				ws_connection.sendBytes(wslib.loadWsChunk(id, '',8,seq));
			}else{
				seq++;
				ws_connection.sendBytes(wslib.loadWsChunk(id, head,2,seq));
				seq++;
				ws_connection.sendBytes(wslib.loadWsChunk(id, '',8,seq));
			}

		};
	};
};

function sendRequest(request, response, port) {
	if (ws_connection != undefined) {
		if (ws_connection.connected) {
			var id = getRequestNumber();
			responseArray[id] = response;
			var wsRequest = {
					id : id,
					method : request.method,
					url : request.url,
					headers : request.headers,
					data:''
				};
			ws_connection.sendUTF(JSON.stringify(wsRequest, true));
			console.log('Port:'+port+", URL:"+request.url);
			// Send a payload only if the request method is POST
			if(request.method === 'POST'){
				var seq = 1;
				request.on('data', function(chunk) {
					seq++;
					ws_connection.sendBytes(wslib.loadWsChunk(id, chunk,1,seq));
				});
				request.on('end', function() {
					seq++;
					ws_connection.sendBytes(wslib.loadWsChunk(id, '',8,seq));
				});
			}
			// Request should be timed out after 120sec.
			__shutdownHttpRequest(id,response);
//			});
		}
	}
}

function __shutdownHttpRequest(id, response) {
	setTimeout(function(id, response) {
		if (response != undefined) {
			response.writeHead('500', {
				'Content-Type' : 'text/plain'
			});
//			response.write("Error: No response from proxy server");
			response.end();
			// responseArray should be initialized as well
			setTimeout(function(id) {
				delete responseArray[id];
			}, 100000,id);
		}
	}, 100000,id,response);
}
