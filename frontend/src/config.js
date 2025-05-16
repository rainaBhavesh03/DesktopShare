// config.js - Frontend configuration
const CONFIG = {
	API_URL: 'https://192.168.1.7:4000/api', // Backend API URL
	WEBSOCKET_URL: 'wss://192.168.1.7:4000', // Socket.io URL
	ICE_SERVERS: [
		{
			urls: 'turn:openrelay.metered.ca:80',
			username: 'openrelayproject',
			credential: 'openrelayproject'
		}
	],
	ICE_CANDIDATE_POOL_SIZE: 10
};

