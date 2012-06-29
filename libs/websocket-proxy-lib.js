exports.loadWsChunk = function(uuid, chunk) {
	var offset = 25;
	var version = '1';
	var buf = new Buffer(chunk.length + offset);
	buf.write(version,0,'ascii');
	var uuid_array = uuid.split('-');
	var start = 1;
	for(i in uuid_array){
		buf.write(uuid_array[i],start,'base64');
		start = start + Buffer.byteLength(uuid_array[i],'base64');
	}
	for ( var i = 0; i < chunk.length; i++) {
		buf[offset + i] = chunk[i];
	}
	return buf;
};

exports.unloadWsChunk = function(chunk) {
	var offset = 25;
	var version = chunk.toString('ascii',start = 0,end = 1);
	var uuid_array = [];
	uuid_array.push(chunk.toString('base64',start=1,end=7));
	uuid_array.push(chunk.toString('base64',start=7,end=10));
	uuid_array.push(chunk.toString('base64',start=10,end=13));
	uuid_array.push(chunk.toString('base64',start=13,end=16));
	uuid_array.push(chunk.toString('base64',start=16,end=25));
	var id = uuid_array.join('-');
	return {
		version:version,
		id : id,
		payload : chunk.slice(offset)
	};
};