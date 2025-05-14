// app.js - Frontend WebRTC logic
// Initialize MDC components
document.addEventListener('DOMContentLoaded', () => {
	const buttons = document.querySelectorAll('.mdc-button');
	buttons.forEach(button => {
		mdc.ripple.MDCRipple.attachTo(button);
	});
});

// WebRTC variables
let peerConnection = null;
let localStream = null;
let remoteStream = null;
let roomDialog = null;
let roomId = null;
let isCaller = null;
let answerPollingInterval = null;
let remoteCandidatePollingInterval = null;
let callerStatusPollingInterval = null;
let hasInitializedMedia = false; // Track if we've already initialized media

// API endpoints
const api = {
	createRoom: () => `${CONFIG.API_URL}/rooms`,
	getRoom: (roomId) => `${CONFIG.API_URL}/rooms/${roomId}`,
	addAnswer: (roomId) => `${CONFIG.API_URL}/rooms/${roomId}/answer`,
	addCallerCandidate: (roomId) => `${CONFIG.API_URL}/rooms/${roomId}/callerCandidates`,
	addCalleeCandidate: (roomId) => `${CONFIG.API_URL}/rooms/${roomId}/calleeCandidates`,
	getCallerCandidates: (roomId) => `${CONFIG.API_URL}/rooms/${roomId}/callerCandidates`,
	getCalleeCandidates: (roomId) => `${CONFIG.API_URL}/rooms/${roomId}/calleeCandidates`,
	deleteRoom: (roomId) => `${CONFIG.API_URL}/rooms/${roomId}`,
	resetRoomForCalleeLeave: (roomId) => `${CONFIG.API_URL}/rooms/${roomId}/resetForCalleeLeave`,
	updateOffer: (roomId) => `${CONFIG.API_URL}/rooms/${roomId}/offer`
};

// API helper functions
async function apiRequest(url, method = 'GET', data = null) {
	const options = {
		method,
		headers: {
			'Content-Type': 'application/json'
		}
	};

	if (data) {
		options.body = JSON.stringify(data);
	}

	const response = await fetch(url, options);

	if (!response.ok) {
		const error = await response.json();
		throw new Error(error.error || 'API request failed');
	}

	if (method === 'DELETE') {
		return { success: true };
	}

	return await response.json();
}

// Initialize the application
async function init() {
	document.querySelector('#cameraBtn').addEventListener('click', openUserMedia);
	document.querySelector('#hangupBtn').addEventListener('click', hangUp);
	document.querySelector('#createBtn').addEventListener('click', createRoom);
	document.querySelector('#joinBtn').addEventListener('click', joinRoom);
	roomDialog = new mdc.dialog.MDCDialog(document.querySelector('#room-dialog'));

	// Auto-initialize media at startup
	//await openUserMedia();
}

function startPollingForRejoin() {
	console.log('[Rejoin] Starting answer + candidate polling sequence...');

	// Make sure any existing polling is cleared
	if (answerPollingInterval) {
		clearInterval(answerPollingInterval);
		answerPollingInterval = null;
	}
	if (remoteCandidatePollingInterval) {
		clearInterval(remoteCandidatePollingInterval);
		remoteCandidatePollingInterval = null;
	}

	pollForRemoteAnswer().then(() => {
		console.log('[Rejoin] Answer received, now polling for ICE candidates');
		pollForRemoteCandidates('callee');
	}).catch(error => {
		console.error('[Rejoin] Error in polling sequence:', error);
	});
}

async function initializeCallerPeerConnection() {
	console.log('Creating new RTCPeerConnection with config:', CONFIG);

	peerConnection = new RTCPeerConnection({
		iceServers: CONFIG.ICE_SERVERS,
		iceCandidatePoolSize: CONFIG.ICE_CANDIDATE_POOL_SIZE
	});
	registerPeerConnectionListeners();

	// Add local tracks
	localStream.getTracks().forEach(track => {
		peerConnection.addTrack(track, localStream);
	});

	// Add ICE candidate handler
	peerConnection.addEventListener('icecandidate', async event => {
		if (event.candidate && roomId) {
			console.log('Got local ICE candidate:', event.candidate);
			try {
				await apiRequest(api.addCallerCandidate(roomId), 'POST', {
					candidate: event.candidate.toJSON()
				});
			} catch (error) {
				console.error('Failed to add caller candidate:', error);
			}
		}
	});

	// Add remote track handler
	peerConnection.addEventListener('track', event => {
		console.log('Got remote track:', event.streams[0]);
		event.streams[0].getTracks().forEach(track => {
			console.log('Adding track to remoteStream:', track);
			remoteStream.addTrack(track);
		});
	});
}

// Create a new room
async function createRoom() {
	document.querySelector('#createBtn').disabled = true;
	document.querySelector('#joinBtn').disabled = true;
	document.querySelector('#hangupBtn').disabled = false;

	try {
		await initializeCallerPeerConnection();

		const offer = await peerConnection.createOffer();
		await peerConnection.setLocalDescription(offer);

		const roomData = await apiRequest(api.createRoom(), 'POST', {
			offer: {
				type: offer.type,
				sdp: offer.sdp
			}
		});

		roomId = roomData.roomId;
		isCaller = true;
		document.querySelector('#currentRoom').innerText = `Current room is ${roomId} - You are the caller!`;

		startPollingForRejoin();

	} catch (error) {
		console.error('Error creating room:', error);
		alert('Failed to create room. Please try again.');
		document.querySelector('#createBtn').disabled = false;
		document.querySelector('#joinBtn').disabled = false;
		document.querySelector('#hangupBtn').disabled = true;
	}
}

// Poll for remote answer
function pollForRemoteAnswer() {
	return new Promise(resolve => {
		if (answerPollingInterval) {
			clearInterval(answerPollingInterval);
		}

		console.log('[Polling] Starting answer polling...');
		answerPollingInterval = setInterval(async () => {
			try {
				const roomData = await apiRequest(api.getRoom(roomId));

				if (roomData && roomData.answer) {
					console.log('[Polling] Found an answer in room data');

					// Check if peer connection is in a state to receive remote description
					if (!peerConnection) {
						console.error('[Polling] No peer connection available');
						return;
					}

					if (peerConnection.signalingState === 'closed') {
						console.error('[Polling] Peer connection is closed');
						return;
					}

					try {
						// Always attempt to set the remote description - WebRTC will
						// properly handle duplicate descriptions internally
						await peerConnection.setRemoteDescription(new RTCSessionDescription(roomData.answer));
						console.log('[Polling] Successfully set remote description');

						// Stop polling for answer once we've got it
						clearInterval(answerPollingInterval);
						answerPollingInterval = null;

						resolve(); // Now it's safe to poll ICE
					} catch (error) {
						console.error('[Polling] Error setting remote description:', error);

						// Check if we need to handle specific signaling state errors
						if (error.name === 'InvalidStateError') {
							console.warn('[Polling] Invalid state error when setting remote description. State:',
								peerConnection.signalingState);

							// If in a non-recoverable state, we might need to recreate the connection
							if (['closed'].includes(peerConnection.signalingState)) {
								console.log('[Polling] Connection in closed state, attempting recreation');

								// Only recreate if we're the caller
							}
						}
					}
				}
			} catch (error) {
				console.error('[Polling] Error polling for answer:', error);
			}
		}, 1000);
	});
}

// Poll for remote ICE candidates
async function pollForRemoteCandidates(type) {
	let processedCandidates = 0;
	const candidateType = type === 'caller' ? 'callerCandidates' : 'calleeCandidates';
	const apiEndpoint = type === 'caller' ? api.getCallerCandidates : api.getCalleeCandidates;

	if (remoteCandidatePollingInterval) {
		clearInterval(remoteCandidatePollingInterval);
	}

	console.log(`[ICE Polling] Starting ${candidateType} polling...`);
	remoteCandidatePollingInterval = setInterval(async () => {
		// Skip polling if connection is not in a valid state
		if (!peerConnection || peerConnection.signalingState === 'closed') {
			console.log('[ICE Polling] Skipping poll - peer connection not ready');
			return;
		}

		// Only process ICE candidates if we have a remote description
		if (!peerConnection.remoteDescription) {
			console.log('[ICE Polling] Waiting for remote description before processing ICE candidates');
			return;
		}

		try {
			const response = await apiRequest(apiEndpoint(roomId));

			if (response && response.candidates && response.candidates.length > processedCandidates) {
				const newCandidates = response.candidates.slice(processedCandidates);
				console.log(`[ICE Polling] Found ${newCandidates.length} new ${candidateType}`);

				for (const candidate of newCandidates) {
					try {
						await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
						console.log(`[ICE Polling] Added ${candidateType}`);
					} catch (e) {
						console.error(`[ICE Polling] Error adding ${candidateType}:`, e);
					}
				}

				processedCandidates = response.candidates.length;
			}
		} catch (error) {
			console.error(`[ICE Polling] Error polling for ${candidateType}:`, error);
		}
	}, 500);
}

// Poll to check if room exists
async function pollForRoom() {
	if (isCaller || !roomId) return;

	console.log('Starting caller status polling');
	callerStatusPollingInterval = setInterval(async () => {
		try {
			const roomData = await apiRequest(api.getRoom(roomId));

			if (!roomData) {
				console.log('Room no longer exists. Hanging Up for Callee');
				clearInterval(callerStatusPollingInterval);
				hangUp();
				return;
			}
		} catch (error) {
			// A 404 error could indicate the room was deleted
			if (error.message && (error.message.includes('404') || error.message.includes('not found'))) {
				console.log('Room not found, caller likely hung up');
				clearInterval(callerStatusPollingInterval);
				hangUp();
				return;
			}
			console.error('Error polling caller status:', error);
		}
	}, 2000); // Check every 2 seconds
}

// Join an existing room
function joinRoom() {
	document.querySelector('#createBtn').disabled = true;
	document.querySelector('#joinBtn').disabled = true;
	document.querySelector('#hangupBtn').disabled = false;

	document.querySelector('#confirmJoinBtn').addEventListener('click', async () => {
		roomId = document.querySelector('#room-id').value.trim();
		console.log('Join room:', roomId);
		document.querySelector('#currentRoom').innerText = `Current room is ${roomId} - You are the callee`;
		isCaller = false;

		await joinRoomById(roomId);
	}, { once: true });

	roomDialog.open();
}

// Join a room by ID
async function joinRoomById(roomId) {
	try {
		// Get room data from API
		const roomData = await apiRequest(api.getRoom(roomId));

		if (roomData) {
			console.log('Create PeerConnection with configuration:', CONFIG);
			peerConnection = new RTCPeerConnection({
				iceServers: CONFIG.ICE_SERVERS,
				iceCandidatePoolSize: CONFIG.ICE_CANDIDATE_POOL_SIZE
			});
			registerPeerConnectionListeners();

			// Add local tracks to the connection
			localStream.getTracks().forEach(track => {
				peerConnection.addTrack(track, localStream);
			});

			// Collecting ICE candidates
			peerConnection.addEventListener('icecandidate', async event => {
				if (event.candidate) {
					console.log('Got local ICE candidate:', event.candidate);
					try {
						await apiRequest(api.addCalleeCandidate(roomId), 'POST', {
							candidate: event.candidate.toJSON()
						});
					} catch (error) {
						console.error('Failed to add callee candidate:', error);
					}
				}
			});

			peerConnection.addEventListener('track', event => {
				console.log('Got remote track:', event.streams[0]);
				event.streams[0].getTracks().forEach(track => {
					console.log('Adding track to remoteStream:', track);
					remoteStream.addTrack(track);
				});
			});

			// Set remote description (offer)
			const offer = roomData.offer;
			console.log('Got offer:', offer);
			await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));

			// Create answer
			const answer = await peerConnection.createAnswer();
			console.log('Created answer:', answer);
			await peerConnection.setLocalDescription(answer);

			// Send answer to backend
			try {
				await apiRequest(api.addAnswer(roomId), 'POST', {
					answer: {
						type: answer.type,
						sdp: answer.sdp
					}
				});
			} catch (error) {
				console.error('Error sending answer:', error);
				alert('Failed to send answer to remote peer.');
			}

			// Start the poll for room
			pollForRoom();

			// Poll for remote ICE candidates
			pollForRemoteCandidates('caller');

		} else {
			alert(`No room found with ID: ${roomId}`);
			document.querySelector('#createBtn').disabled = false;
			document.querySelector('#joinBtn').disabled = false;
			document.querySelector('#hangupBtn').disabled = true;
		}
	} catch (error) {
		console.error('Error joining room:', error);
		alert(`Failed to join room with ID: ${roomId}`);
		document.querySelector('#createBtn').disabled = false;
		document.querySelector('#joinBtn').disabled = false;
		document.querySelector('#hangupBtn').disabled = true;
	}
}

// Open user media (camera/mic)
async function openUserMedia() {
	// If we've already initialized media, don't do it again
	if (hasInitializedMedia && localStream) {
		console.log('Media already initialized, skipping getUserMedia');
		return;
	}

	try {
		let getUserMedia = null;

		// Check for modern API
		if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
			getUserMedia = (constraints) => navigator.mediaDevices.getUserMedia(constraints);
		}
		// Fallback for older browsers
		else {
			getUserMedia = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia;
			if (getUserMedia) {
				// Promisify the older getUserMedia
				getUserMedia = (constraints) => new Promise((resolve, reject) => {
					(navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia)
						.call(navigator, constraints, resolve, reject);
				});
			}
		}

		if (!getUserMedia) {
			alert(`getUserMedia is not supported in this browser. \n${navigator.mediaDevices}\n${navigator.mediaDevices.getUserMedia}\n${navigator.webkitGetUserMedia}\n${navigator.mozGetUserMedia}`);
			console.error('getUserMedia is not supported in this browser.');
			return;
		}

		// Request media stream
		const stream = await getUserMedia({ video: true, audio: true });
		document.querySelector('#localVideo').srcObject = stream;
		localStream = stream;

		// Only create a new remoteStream if we don't have one
		if (!remoteStream) {
			remoteStream = new MediaStream();
			document.querySelector('#remoteVideo').srcObject = remoteStream;
		}

		// Hide the camera button once media is initialized
		document.querySelector('#cameraBtn').style.display = 'none';
		document.querySelector('#joinBtn').disabled = false;
		document.querySelector('#createBtn').disabled = false;
		document.querySelector('#hangupBtn').disabled = true;

		// Mark that we've initialized media
		hasInitializedMedia = true;
	} catch (error) {
		console.error('Error opening user media:', error);
		alert(`Failed to access camera and microphone. Please check your permissions.\n\n${error}`);
	}
}

// Hang up the call
async function hangUp() {
	console.log('Hanging up...');

	// We DON'T stop local media tracks here anymore
	// This preserves camera permissions between calls

	// Clear any polling intervals
	if (answerPollingInterval) clearInterval(answerPollingInterval);
	if (remoteCandidatePollingInterval) clearInterval(remoteCandidatePollingInterval);
	if (callerStatusPollingInterval) clearInterval(callerStatusPollingInterval);

	// Stop remote media tracks
	if (remoteStream) {
		remoteStream.getTracks().forEach(track => {
			try {
				track.stop();
				console.log(`Stopped remote track: ${track.kind}`);
			} catch (error) {
				console.error(`Error stopping remote track ${track.kind}:`, error);
			}
		});

		// Create a new remoteStream but keep the same reference
		remoteStream = new MediaStream();
		document.querySelector('#remoteVideo').srcObject = remoteStream;
	}

	await roomCleanUp();

	// Close peer connection
	if (peerConnection) {
		try {
			peerConnection.onicecandidate = null;
			peerConnection.ontrack = null;
			peerConnection.onconnectionstatechange = null;
			peerConnection.oniceconnectionstatechange = null;
			peerConnection.close();
			console.log('Peer connection closed.');
		} catch (error) {
			console.error('Error closing peer connection:', error);
		}
	}
	peerConnection = null;

	// Reset UI (but keep camera button hidden)
	console.log('Resetting UI elements.');
	document.querySelector('#joinBtn').disabled = false;
	document.querySelector('#createBtn').disabled = false;
	document.querySelector('#hangupBtn').disabled = true;
	document.querySelector('#currentRoom').innerText = '';

	console.log('Hang up complete.');
}

// Room cleanup logic
async function roomCleanUp() {
	if (roomId) {
		try {
			if (isCaller) {
				console.log(`Caller cleaning up room ${roomId}`);
				await new Promise(resolve => setTimeout(resolve, 1000));
				try {
					await apiRequest(api.deleteRoom(roomId), 'DELETE');
					console.log(`Room ${roomId} deleted successfully`);
					roomId = null;
					isCaller = null;
				} catch (error) {
					console.error(`Error deleting room ${roomId}:`, error);
				}
			} else {
				// Callee: reset room state to allow rejoin
				console.log(`Callee leaving room ${roomId}, resetting room for potential rejoin.`);
				try {
					await apiRequest(api.resetRoomForCalleeLeave(roomId), 'PATCH');
					console.log('Callee backend cleanup successful');
					roomId = null;
					isCaller = null;
				} catch (error) {
					console.error(`Error in Callee backend cleanup:`, error);
				}
			}
		} catch (error) {
			console.error('Error in room cleanup:', error);
		}
	}
}

async function recreatePeerConnectionForRejoin() {
	console.log('[Rejoin] Rebuilding peerConnection for callee reconnect.');

	// Clean up existing peer connection
	if (peerConnection) {
		try {
			// Remove all event listeners to prevent memory leaks
			peerConnection.onicecandidate = null;
			peerConnection.ontrack = null;
			peerConnection.onconnectionstatechange = null;
			peerConnection.oniceconnectionstatechange = null;
			peerConnection.onsignalingstatechange = null;
			peerConnection.onicegatheringstatechange = null;

			peerConnection.close();
			console.log('[Rejoin] Closed old peerConnection.');
		} catch (e) {
			console.warn('[Rejoin] Error closing peerConnection:', e);
		}
		peerConnection = null;
	}

	// Clear any existing polling intervals
	if (answerPollingInterval) {
		clearInterval(answerPollingInterval);
		answerPollingInterval = null;
	}
	if (remoteCandidatePollingInterval) {
		clearInterval(remoteCandidatePollingInterval);
		remoteCandidatePollingInterval = null;
	}

	// IMPORTANT: Reinitialize the remoteStream to ensure we can receive new tracks
	if (remoteStream) {
		// Stop any existing tracks
		remoteStream.getTracks().forEach(track => {
			track.stop();
		});
	}
	// Create a new MediaStream and attach it to the remote video element
	remoteStream = new MediaStream();
	document.querySelector('#remoteVideo').srcObject = remoteStream;
	console.log('[Rejoin] Reinitialized remoteStream for new connection');

	// Reuse existing caller peer connection initialization logic
	try {
		await initializeCallerPeerConnection();

		console.log('[Rejoin] Creating new offer');
		const offer = await peerConnection.createOffer();
		await peerConnection.setLocalDescription(offer);

		// Check if API endpoint exists to update the offer
		if (api.updateOffer) {
			try {
				await apiRequest(api.updateOffer(roomId), 'PATCH', {
					offer: {
						type: offer.type,
						sdp: offer.sdp
					}
				});
				console.log('[Rejoin] Updated offer on server');
			} catch (error) {
				console.error('[Rejoin] Failed to update offer on server:', error);
			}
		}

		// Start polling for answer and candidates
		startPollingForRejoin();
		console.log('[Rejoin] PeerConnection successfully rebuilt and ready for reconnection');
	} catch (error) {
		console.error('[Rejoin] Error recreating peer connection:', error);
	}
}

// Register peer connection event listeners
function registerPeerConnectionListeners() {
	// The connectionstatechange event is the most modern and comprehensive way to track connection status
	peerConnection.addEventListener('connectionstatechange', () => {
		const state = peerConnection.connectionState;
		console.log(`Connection state change: ${state}`);

		// Handle successful connection
		if (state === 'connected') {
			console.log('Connection established successfully');

			// Stop polling when connected
			if (remoteCandidatePollingInterval) {
				clearInterval(remoteCandidatePollingInterval);
				remoteCandidatePollingInterval = null;
			}
		}
		// Handle disconnection (only for caller)
		else if (isCaller && (state === 'disconnected' || state === 'failed')) {
			console.log('Connection disconnected/failed - preparing for rejoin...');
			recreatePeerConnectionForRejoin();
		}
	});

	// Keeping logging for debugging purposes
	peerConnection.addEventListener('iceconnectionstatechange', () => {
		console.log(`ICE connection state: ${peerConnection.iceConnectionState}`);
	});

	peerConnection.addEventListener('signalingstatechange', () => {
		console.log(`Signaling state: ${peerConnection.signalingState}`);
	});

	peerConnection.addEventListener('icegatheringstatechange', () => {
		console.log(`ICE gathering state: ${peerConnection.iceGatheringState}`);
	});
}

// Initialize the application
init();
