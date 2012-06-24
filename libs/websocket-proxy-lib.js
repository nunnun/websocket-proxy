exports.loadWsChunk = function(uuid, chunk) {
	var offset = 36;
	var buf = new Buffer(chunk.length + offset);
	buf.write(uuid, 0, encoding = 'utf-8');
	for ( var i = 0; i < chunk.length; i++) {
		buf[offset + i] = chunk[i];
	}
	return buf;
};

exports.unloadWsChunk = function(chunk) {
	var offset = 36;
	var id = chunk.toString('utf-8', start = 0, end = offset);
	return {
		id : id,
		payload : chunk.slice(offset)
	};
};