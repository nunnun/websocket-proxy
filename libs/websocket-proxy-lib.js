exports.loadWsChunk = function(id, chunk,opcode,seq) {
	var offset = 4;
	opcode = opcode || 0; //0: Continuation Frame, 1:data transfer, 8:close
	var version = 1; // 1~15
	var header = (parseInt(version,10) << 4) + parseInt(opcode,10);
	var buf = new Buffer(chunk.length + offset);
	buf[0] = parseInt(header.toString(10));
	
	var id = parseInt(id, '10');
	buf[1] = id >> 8;
	buf[2] = id & 0xff;
	buf[3] = seq;
	
	for ( var i = 0; i < chunk.length; i++) {
		buf[offset + i] = chunk[i];
	}
	return buf;
};

exports.unloadWsChunk = function(chunk) {
	var offset = 4;
	var header = parseInt(chunk[0],10);
	var version = header >> 4;
	var opcode = header & 0xf;
	var id = (parseInt(chunk[1],10) << 8) + parseInt(chunk[2],10);
	
	return {
		version:version,
		opcode:opcode,
		id : id,
		seq:chunk[3],
		payload : chunk.slice(offset)
	};
};