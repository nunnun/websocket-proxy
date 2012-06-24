var WebSocketServer = require('websocket').server;
var http = require('http');
var url = require('url');

var maxConnectionsPerHost = 6;

var server = http.createServer(function(request, response) {
	console.log((new Date()) + ' Received request for ' + request.url + '\n'
			+ JSON.stringify(request.headers, true, 2));
	response.writeHead(200, {
		'Content-Type' : 'text/plain'
	});
	response.write('request successfully proxied!' + '\n'
			+ JSON.stringify(request.headers, true, 2));
	response.end();
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

	var connection = request.accept('echo-test', request.origin);
	handleConnection(connection);

});

// process.on('uncaughtException', function (err) {
// console.log('uncaughtException => ' + err);
// });

server.listen(8080, function() {
	console.log((new Date()) + ' Server is listening on port 8080');
});

function buildWsChunk(uuid, chunk, end) {
	var offset = 36;
	var buf = new Buffer(chunk.length + offset);
	buf.write(uuid, 0, encoding = 'utf-8');
	for ( var i = 0; i < chunk.length; i++) {
		buf[offset + i] = chunk[i];
	}
	return buf;
}

function handleConnection(connection) {
	var hostSockets = {};
	var _pendingRequests = {};

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
	

	console.log((new Date()) + ' Connection accepted.');

	connection.on('error', function(err) {
		console.log("wserror:" + err);
	});

	connection.on('message', function(message) {
		if (message.type === 'utf8') {
			connection.sendUTF(message.utf8Data);
		} else if (message.type === 'binary') {
			var wsRequest = JSON.parse(message.binaryData.toString());

			// ヘッダー調整
			var requestHeader = wsRequest.headers;
			if ('proxy-connection' in requestHeader) {
				// myHeaders['Connection'] = myHeaders['proxy-connection'];
				requestHeader['Connection'] = 'close';
				delete requestHeader['proxy-connection'];
			}
			if ('cache-control' in requestHeader) {
				delete requestHeader['cache-control'];
			}

			// URLパース

			var parseUri = function(uri) {
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

			var proxyConnection = function(wsRequest, connection, done) {

				var targetUrl = parseUri(wsRequest.url);

				var client = http.createClient(targetUrl.port,
						targetUrl.hostname);
				client.on('error', function(err) {
					console.log("http-client-error:");
					console.log(err);
				});
				var httpRequest = client.request(wsRequest.method,
						targetUrl.reqPath, requestHeader);
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
					connection.sendUTF(JSON.stringify(wsResponse, true));

					response.on('data',
							function(chunk) {
								connection.sendBytes(buildWsChunk(wsRequest.id,
										chunk));
							});
					response.on('end', function() {
						var wsResponse = {
							id : wsRequest.id,
							end : true,
						};
						connection.sendUTF(JSON.stringify(wsResponse, true));
					});
				});

				if (wsRequest.data != "") {
					httpRequest.write(wsRequest.data);
				}
				httpRequest.end();
				done();
			};

			var targetUri = parseUri(wsRequest.url);

			// Limit connection to WebServers
			client_limit(targetUri.hostname, proxyConnection, wsRequest,
					connection);

		}
	});

	connection.on('close', function(reasonCode, description) {
		console.log((new Date()) + ' Peer ' + connection.remoteAddress
				+ ' disconnected.');
	});
}
