exports.loadWsChunk = function(id, chunk,opcode,seq) {
	var offset = 4;
	opcode = opcode || 0; //0: Continuation Frame, 1:data transfer, 8:close
	var version = 1; // 1~15
	var header = '' + parseInt(version,10).toString(16) + parseInt(opcode,10).toString(16);
	var buf = new Buffer(chunk.length + offset);
	buf[0] = parseInt(header.toString(10));
	
	var hexSeq = parseInt(id, '10').toString(16);
	var seq1,seq2;
	if(hexSeq.length > 2){
		seq1 = '';
		for(var i=0;i<hexSeq.length-2;i++){
			seq1 += hexSeq[i];
		}
		seq2 = hexSeq[hexSeq.length-2]+ hexSeq[hexSeq.length-1];
	}else{
		seq1 = '00';
		seq2 = hexSeq;
	}
	buf[1] = parseInt(parseInt(seq1,'16').toString(10));
	buf[2] = parseInt(parseInt(seq2,'16').toString(10));
	buf[3] = seq;	
	
	for ( var i = 0; i < chunk.length; i++) {
		buf[offset + i] = chunk[i];
	}
	return buf;
};

exports.unloadWsChunk = function(chunk) {
	var offset = 4;
	var header = '' + chunk[0];
	var version = parseInt(header[0], 10).toString(16);
	var opcode = parseInt(header[1], 10).toString(16);
	var hexSeq ='';
	if(chunk[1] > 0){
		hexSeq += parseInt(chunk[1],10).toString();
	}
	if(parseInt(chunk[2],10).toString(16).length < 2){
		hexSeq += '0' + parseInt(chunk[2],10).toString(16);
	}else{
		hexSeq += parseInt(chunk[2],10).toString(16);
	}
	var id = parseInt(parseInt(hexSeq,16).toString(10));

	return {
		version:version,
		opcode:opcode,
		id : id,
		seq:chunk[3],
		payload : chunk.slice(offset)
	};
};