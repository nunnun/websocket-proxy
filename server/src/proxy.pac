function FindProxyForURL(url,host) {

	var proxys = [
							'127.0.0.1:8000',
							'127.0.0.1:8001',
							'127.0.0.1:8002',
							'127.0.0.1:8003',
							'127.0.0.1:8004',
							'127.0.0.1:8005',
							'127.0.0.1:8006',
							'127.0.0.1:8007',
							];
							
	if (url.substring(0, 5) == "http:") {
		return "PROXY " + proxys[Math.floor(Math.random() * proxys.length)];
	}else if(url.substring(0, 6) == "https:"){
		return "PROXY " + proxys[Math.floor(Math.random() * proxys.length)];	
    }else{
    	return "DIRECT";
    }
}
