var WebSocketServer = require('websocket').server;
var http = require('http');
var url = require('url');
var fs = require('fs');
var net = require('net');
var wslib = require('../../libs/websocket-proxy-lib');

var maxConnectionsPerHost = 8;
var anonymousProxy = false;

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
		if(wsRequest.method != "CONNECT"){
			var targetUrl = parseUri(wsRequest.url);
			var options = {
				hostname: targetUrl.hostname,
				port: targetUrl.port,
				path: targetUrl.reqPath,
				method: wsRequest.method,
				header: wsRequest.headers
			};
			var httpRequest = http.request(options,function(response) {
				// Headerのみ先に返す
				var wsResponse = {
					id : wsRequest.id,
					statusCode : response.statusCode,
					headers : response.headers,
					method: wsRequest.method,
					end : false
				};
				console.log(connection.remoteAddress + " - - [" + (new Date()) + '] ' + 'Req:' + wsRequest.id + ", URL:" + wsRequest.url);
				connection.sendUTF(JSON.stringify(wsResponse, true),function(err){
					if (err) console.error("send()header error: " + err);
				});
				var seq = 0;
				response.on('data',
						function(chunk) {
						seq++;
						connection.sendBytes(wslib.loadWsChunk(wsResponse.id,
									chunk,1,seq),function(err){
								if (err){
									console.error("send()data error: " + err);
								}
							});
							
						});
				response.on('end', function() {
					seq++;
					connection.sendBytes(wslib.loadWsChunk(wsResponse.id,'',8,seq),function(err){
						if (err) console.error("send()end error: " + err);
					});
				});
			});
	
			httpRequest.on('error', function(err) {
				console.log("http-client-error:");
				console.log(err);
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
		}else{
			var targetUrl = parseUri(wsRequest.url);
			var srvSocket = net.connect(targetUrl.port, targetUrl.hostname, function() {
				var seq = 1;
				var wsResponse = {
						id : wsRequest.id,
						statusCode : 200,
						headers : "",
						method: wsRequest.method,
						end : false
					};
				console.log(connection.remoteAddress + " - - [" + (new Date()) + '] ' + 'Req:' + wsRequest.id + ", URL:" + wsRequest.url);
				srvSocket.on('data',function(chunk){
					seq++;
					connection.sendBytes(wslib.loadWsChunk(wsResponse.id,
								chunk,2,seq),function(err){
							if (err){
								console.error("send()data error: " + err);
							}
						});
				});
			
				srvSocket.on('end',function(chunk){
					seq++;
					console.log('Server socket on end, id:' + wsResponse.id+ ", seq:" + seq);
					connection.sendBytes(wslib.loadWsChunk(wsResponse.id,'',9,seq),function(err){
						if (err) console.error("send()end error: " + err);
					});
					delete clientRequests[wsResponse.id];
				});
				srvSocket.on('error',function(e){
					console.log(e);
					console.log("Server socket on error, id:" + wsResponse.id+ ", seq:" + seq);
					connection.sendBytes(wslib.loadWsChunk(wsResponse.id,'',9,seq),function(err){
						if (err) console.error("send()end error: " + err);
					});
					delete clientRequests[chunk.id];
				});
				srvSocket.on('timeout',function(){
					cconsole.log("Server socket on timeout, id:" + wsResponse.id+ ", seq:" + seq);
					connection.sendBytes(wslib.loadWsChunk(wsResponse.id,'',9,seq),function(err){
						if (err) console.error("send()end error: " + err);
					});
					delete clientRequests[chunk.id];
				});
				srvSocket.write(wsRequest.data);
				try{
					clientRequests[wsRequest.id].srvSocket = srvSocket;
					connection.sendUTF(JSON.stringify(wsResponse, true),function(err){
						if (err) console.error("send()header error: " + err);
					});
				}catch(e){
					console.log(e);
				}		
			});
			done();
		}
	};

	console.log((new Date()) + ' Connection accepted.');

	connection.on('error', function(err) {
		console.log("wserror:" + err);
	});

	connection.on('message', function(message) {
		if (message.type === 'utf8') {
			var wsRequest = JSON.parse(message.utf8Data);
			if (wsRequest.method != 'CONNECT'){
				// ヘッダー調整
				if ('proxy-connection' in wsRequest.headers) {
					wsRequest.headers['Connection'] = wsRequest.headers['proxy-connection'];
					//wsRequest.headers['Connection'] = 'close';
					delete wsRequest.headers['proxy-connection'];
				}
				if ('cache-control' in wsRequest.headers) {
					delete wsRequest.headers['cache-control'];
				}
				// via header
				if(anonymousProxy == false){
					wsRequest.headers['via'] = connection.remoteAddress;
					wsRequest.headers['HTTP_CLIENT_IP'] = connection.remoteAddress;
					wsRequest.headers['HTTP_X_FORWARDED_FOR'] = connection.remoteAddress;
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
			}else{
				wsRequest.url = "https://" + wsRequest.url;
				var targetUri = parseUri(wsRequest.url);
				clientRequests[wsRequest.id] = {
						hostname : targetUri.hostname,
						wsRequest : wsRequest,
						srvSocket: {}
				};
			}
			
		} else if (message.type === 'binary') {
			var chunk = wslib.unloadWsChunk(message.binaryData);
			if(chunk.opcode == 1){
			clientRequests[chunk.id].wsRequest.data += chunk.payload;
			}else if(chunk.opcode ==8){
				var req = clientRequests[chunk.id];
				client_limit(req.hostname, proxyConnection, req.wsRequest,connection);
			}else if(chunk.opcode == 2){
				try{
					var req = clientRequests[chunk.id];
					req.srvSocket.write(chunk.payload);
				}catch(e){
					console.log("----")
					console.log(e);
					console.log("Server ws receive error, id:"+ chunk.id + ", seq:" + chunk.seq + ", opcode:2\r\n----");
				}
			}else if(chunk.opcode == 9){
				var req = clientRequests[chunk.id];
				try{
					req.srvSocket.end();
				}catch(e){
					console.log("----")
					console.log(e);
					console.log("Server ws receive error, id:"+ chunk.id + ", seq:" + chunk.seq + ", opcode:9\r\n----");
				}finally{
					delete clientRequests[chunk.id];
				}
			}
		}
	});

	connection.on('close', function(reasonCode, description) {
		console.log((new Date()) + ' Peer ' + connection.remoteAddress
				+ ' disconnected.');
	});
}


