// config.js - Frontend configuration
const CONFIG = {
	API_URL: 'http://localhost:4000/api',  // Backend API URL
	ICE_SERVERS: [
		{
			urls: 'turn:openrelay.metered.ca:80',
			username: 'openrelayproject',
			credential: 'openrelayproject'
		}
	],
	ICE_CANDIDATE_POOL_SIZE: 10
};

