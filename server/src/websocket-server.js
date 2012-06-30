var WebSocketServer = require('websocket').server;
var http = require('http');
var url = require('url');
var fs = require('fs');
var wslib = require('../../libs/websocket-proxy-lib');

var maxConnectionsPerHost = 8;

var server = http.createServer(function(request, response) {
	console.log((new Date()) + ' Received request for ' + request.url + '\n'
			+ JSON.stringify(request.headers, true, 2));
	if (request.url == "/proxy.pac") {
		fs.readFile('server/src/proxy.pac', 'utf8', function(err, data) {
			if (err) {
				response.writeHead(404);
				response.end(err.toString());
			} else {
				response.writeHead(200, {
					'Content-Type' : 'application/javascript'
				});
				response.end(data);
			}
		});
	} else {

		response.writeHead(200, {
			'Content-Type' : 'text/plain'
		});
		response.write('request successfully proxied!' + '\n'
				+ JSON.stringify(request.headers, true, 2));
		response.end();
	}
});

wsServer = new WebSocketServer({
	httpServer : server,
	// You should not use autoAcceptConnections for production
	// applications, as it defeats all standard cross-origin protection
	// facilities built into the protocol and the browser. You should
	// *always* verify the connection's origin and decide whether or not
	// to accept it.
	autoAcceptConnections : false
});

function originIsAllowed(origin) {
	// put logic here to detect whether the specified origin is allowed.
	return true;
}

wsServer.on('error', function(err) {
	console.log('server error:' + err);
});

wsServer.on('request', function(request) {
	if (!originIsAllowed(request.origin)) {
		// Make sure we only accept requests from an allowed origin
		request.reject();
		console.log((new Date()) + ' Connection from origin ' + request.origin
				+ ' rejected.');
		return;
	}
	
	var connection = request.accept('proxy', request.origin);
	handleConnection(connection);

});

// process.on('uncaughtException', function (err) {
// console.log('uncaughtException => ' + err);
// });

server.listen(8080, function() {
	console.log((new Date()) + ' Server is listening on port 8080');
});

function handleConnection(connection) {
	var hostSockets = {};
	var _pendingRequests = {};
	var clientRequests = {};

	function process_pending(hostname) {
		if (_pendingRequests[hostname].length > 0) {
			var cb = _pendingRequests[hostname].shift();
			hostSockets[hostname]++;
			cb(function() {
				hostSockets[hostname]--;
				process.nextTick(process_pending.bind(null, hostname));
			});
		}
	}

	function client_limit(hostname, cb, wsRequest, connection) {
		if (!(hostname in hostSockets)) {
			hostSockets[hostname] = [];
		}
		if (!(hostname in _pendingRequests)) {
			_pendingRequests[hostname] = [];
		}
		if (hostSockets[hostname] < maxConnectionsPerHost) {
			hostSockets[hostname]++;
			cb(wsRequest, connection, function() {
				hostSockets[hostname]--;
				process.nextTick(process_pending.bind(null, hostname));
			});
		} else {
			console.log('Overloaded, queuing clients...');
			_pendingRequests[hostname].push(cb);
		}
	}
	
	function parseUri(uri) {
		var targetUri = url.parse(uri, false);
		if (!targetUri.pathname) {
			targetUri.pathname = '/';
		}
		if (!targetUri.search) {
			targetUri.search = '';
		}
		if (!targetUri.port) {
			targetUri.port = 80;
		}
		targetUri.reqPath = targetUri.pathname + targetUri.search;
		return targetUri;
	};
	
	function proxyConnection(wsRequest, connection, done) {

		var targetUrl = parseUri(wsRequest.url);

		var client = http.createClient(targetUrl.port,
				targetUrl.hostname);
		client.on('error', function(err) {
			console.log("http-client-error:");
			console.log(err);
		});
		var httpRequest = client.request(wsRequest.method,
				targetUrl.reqPath, wsRequest.headers);
		httpRequest.on('error', function(err) {
			console.log("httperror:");
			console.log(err);
		});
		httpRequest.on('response', function(response) {
			// Headerのみ先に返す
			var wsResponse = {
				id : wsRequest.id,
				statusCode : response.statusCode,
				headers : response.headers,
				end : false
			};
			connection.sendUTF(JSON.stringify(wsResponse, true),function(err){
				if (err) console.error("send()header error: " + err);
			});
			var seq = 0;
			response.on('data',
					function(chunk) {
					seq++;
					console.log(wsResponse.id);
					connection.sendBytes(wslib.loadWsChunk(wsResponse.id,
								chunk,1,seq),function(err){
							if (err){
								console.error("send()data error: " + err);
							}
						});
						
					});
			response.on('end', function() {
				seq++;
				console.log(wsResponse.id);
				connection.sendBytes(wslib.loadWsChunk(wsResponse.id,'',8,seq),function(err){
					if (err) console.error("send()end error: " + err);
				});
			});
		});

		if (wsRequest.data != "") {
			httpRequest.write(wsRequest.data);
		}
		httpRequest.end();
		if (wsRequest.method === 'POST'){
			setTimeout(function() {
				delete clientRequests[wsRequest.id];
			}, 10000);
		}else{
			delete clientRequests[wsRequest.id];
		}
		done();
	};

	console.log((new Date()) + ' Connection accepted.');

	connection.on('error', function(err) {
		console.log("wserror:" + err);
	});

	connection.on('message', function(message) {
		if (message.type === 'utf8') {
			var wsRequest = JSON.parse(message.utf8Data);

			// ヘッダー調整
			if ('proxy-connection' in wsRequest.headers) {
				wsRequest.headers['Connection'] = wsRequest.headers['proxy-connection'];
				//wsRequest.headers['Connection'] = 'close';
				delete wsRequest.headers['proxy-connection'];
			}
			if ('cache-control' in wsRequest.headers) {
				delete wsRequest.headers['cache-control'];
			}
			var targetUri = parseUri(wsRequest.url);
			if (wsRequest.method != 'POST') {
				client_limit(targetUri.hostname, proxyConnection,
						wsRequest, connection);
			} else {
				clientRequests[wsRequest.id] = {
					hostname : targetUri.hostname,
					wsRequest : wsRequest
				};
			}
			
		} else if (message.type === 'binary') {
			var chunk = wslib.unloadWsChunk(message.binaryData);
			if(chunk.opcode == 1){
			clientRequests[chunk.id].wsRequest.data += chunk.payload;
			}else if(chunk.opcode ==8){
				var req = clientRequests[chunk.id];
				client_limit(req.hostname, proxyConnection, req.wsRequest,connection);
			}
		}
	});

	connection.on('close', function(reasonCode, description) {
		console.log((new Date()) + ' Peer ' + connection.remoteAddress
				+ ' disconnected.');
	});
}


