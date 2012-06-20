var http = require('http'), zlib = require('zlib'), WebSocketClient = require('websocket').client,uuid = require('node-uuid');

var client = new WebSocketClient();

var responseArray = {};

client.on('connectFailed', function(error) {
	console.log('Connect Error: ' + error.toString());
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
	});
	ws_connection.on('message', function(message) {
		if (message.type === 'utf8') {
			var wsResponse = JSON.parse(message.utf8Data);
			var httpResponse = responseArray[wsResponse.id];
			if(wsResponse.end == false){
//				console.log("Received: '" + JSON.stringify(wsResponse, true,2) + "'");
				httpResponse.writeHead(wsResponse.statusCode, wsResponse.headers);
			}else{
				httpResponse.end();
				delete responseArray[wsResponse.id];
			}
		}else if (message.type === 'binary') {
//	        console.log("Received Binary Message of " + message.binaryData.length + " bytes");
	        var offset = 36;
	        var id = message.binaryData.toString('utf-8',start=0,end=offset);
	        var res = responseArray[id];
	        res.write(message.binaryData.slice(offset));
		}
	});
});

client.connect('ws://localhost:8080/', 'echo-test');

function startProxy() {
	if (ws_connection == undefined) {
		//WebSocketの接続を待つ
		setTimeout(startProxy, 100);
	}else{
	console.log("Proxy Server started");
	http.createServer(function(request, response) {
		sendRequest(request, response);
		}).listen(8000);
	}
}
startProxy();

function sendRequest(request,response) {
	if (ws_connection != undefined) {
		if (ws_connection.connected) {
			var id = uuid.v4();
			responseArray[id] = response;
			var data = '';
			request.on('data',function(chunk){
				data += chunk;
			});
			request.on('end',function(){
//				console.log({'method':request.method,'url':request.url});				
				var wsRequest = {
						id: id,
						method:request.method,
						url:request.url,
						headers:request.headers,
						data:data,
						};
				ws_connection.sendBytes(new Buffer(JSON.stringify(wsRequest, true),'utf-8'));
			});
		}
	}
}
