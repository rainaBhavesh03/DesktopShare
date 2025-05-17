// app.js - Frontend WebRTC logic

// WebRTC variables
let peerConnection = null;
let localStream = null;
let remoteStream = null;
let roomDialog = null;
let createRoomDialog = null;
let roomId = null;
let isCaller = null;
let hasInitializedMedia = false; // Track if we've already initialized media
let audioOptions = [];
let videoOptions = [];
let stream = null;

// Websocket variables
let socket = null;

// Initialize the application
async function init() {
	socket = io(CONFIG.WEBSOCKET_URL);

	// Connection-related events
	socket.on('connect', () => {
		console.log('Connected to signaling server with ID:', socket.id);
	});

	socket.on('disconnect', () => {
		console.log('Disconnected from signaling server');
	});

	socket.on('error', (error) => {
		console.error('Socket error:', error);
	});

	// WebRTC signaling events
	socket.on('offer', async (data) => {
		console.log('Received offer:', data);
		if (!peerConnection) { // don't really need this check
			await initializeCalleePeerConnection();
		}

		try {
			await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
			const answer = await peerConnection.createAnswer();
			await peerConnection.setLocalDescription(answer);

			socket.emit('answer', {
				roomId: data.roomId,
				answer: {
					type: answer.type,
					sdp: answer.sdp
				}
			});

			roomId = data.roomId;
			isCaller = false;
			document.querySelector('#currentRoom').innerText = `Current room is ${roomId} - You are the callee!`;
		} catch (error) {
			console.error('Error handling offer:', error);
		}
	});

	socket.on('answer', async (data) => {
		console.log('Received answer:', data);
		try {
			await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
		} catch (error) {
			console.error('Error setting remote description:', error);
			console.log('Resetting connection');
			resetConnection();
		}
	});

	socket.on('ice-candidate', async (data) => {
		console.log('Received ICE candidate:', data);
		try {
			if (peerConnection) {
				await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
			}
		} catch (error) {
			console.error('Error adding ICE candidate:', error);
		}
	});

	socket.on('user-disconnected', async (data) => {
		console.log('Remote user disconnected:', data);
		// Clean up the connection if the other user leaves
		if (data.roomId === roomId) {
			alert('The other participant has left the call.');
			// Reset the connection but keep the room open
			resetConnection();

			// If we're the caller, reinitialize so we can accept new connections
			if (isCaller) {
				try {
					// Initialize a fresh peer connection
					await initializeCallerPeerConnection();

					// Create a new offer
					const offer = await peerConnection.createOffer();
					await peerConnection.setLocalDescription(offer);

					// Update the room with the new offer
					socket.emit('update-room-offer', {
						roomId: roomId,
						offer: {
							type: offer.type,
							sdp: offer.sdp
						}
					}, (res) => {
						if (res.success) {
							console.log('Room offer updated successfully');
							document.querySelector('#currentRoom').innerText =
								`Current room is ${roomId} - You are the caller! Waiting for someone to join...`;
						} else throw new Error(res.message);
					});
				} catch (error) {
					console.error('Error reinitializing connection:', error);
					alert('Failed to prepare for new connections. Please create a new room.');
					hangUp(); // Fully disconnect on error
				}
			} else {
				document.querySelector('#currentRoom').innerText =
					`Disconnected from room ${roomId}. You can join another room or create a new one.`;
				document.querySelector('#createBtn').disabled = false;
				document.querySelector('#joinBtn').disabled = false;
				document.querySelector('#hangupBtn').disabled = true;
				roomId = null;
				isCaller = null;
			}
		}
	});

	document.querySelector('#permissionBtn').addEventListener('click', openUserMedia);
	document.querySelector('#hangupBtn').addEventListener('click', hangUp);
	document.querySelector('#createBtn').addEventListener('click', () => { createRoomDialog.classList.remove('overlay-hidden'); });
	document.querySelector('#joinBtn').addEventListener('click', () => { roomDialog.classList.remove('overlay-hidden'); });
	document.querySelector('#cameraToggleBtn').addEventListener('click', cameraToggle);
	//document.querySelector('#cameraSwitchBtn').addEventListener('click', );
	document.querySelector('#videoOptions').addEventListener('change', async (event) => {
		const selectedVideoDeviceId = event.target.value;
		try {
			const audioTracks = [...stream.getAudioTracks()];
			if (stream) stream.getVideoTracks().forEach(track => track.stop());
			// Only request a new video stream
			const newStream = await navigator.mediaDevices.getUserMedia({
				video: { deviceId: { exact: selectedVideoDeviceId } },
			});

			stream = new MediaStream([
				...newStream.getVideoTracks(),
				...audioTracks
			]);
			document.querySelector('#localVideo').srcObject = stream;
			localStream = stream;

			if (peerConnection && peerConnection.connectionState !== 'closed') {
				const videoSenders = peerConnection.getSenders().filter(sender =>
					sender.track && sender.track.kind === 'video'
				);
				const audioSenders = peerConnection.getSenders().filter(sender =>
					sender.track && sender.track.kind === 'audio'
				);

				await videoSenders[0].replaceTrack(stream.getVideoTracks()[0]);
				console.log('Replaced video track in RTCPeerConnection');
				await audioSenders[0].replaceTrack(stream.getAudioTracks()[0]);
				console.log('Replaced audio track in RTCPeerConnection');
			}
		} catch (err) {
			alert(`Error switching camera: ${err}`);
			console.error('Error switching camera:', err);
		}
	});

	document.querySelector('#micBtn').addEventListener('click', micToggle);
	roomDialog = document.querySelector('#room-dialog');
	createRoomDialog = document.querySelector('#create-room-dialog');

	// Auto-initialize media at startup
	await openUserMedia();

	// Overlay - Closing from Click on Background logic
	const overlays = document.querySelectorAll('.overlay'); // targets both create and join
	overlays.forEach(overlay => {
		const overlaySurface = overlay.querySelector('.overlay-surface');
		overlaySurface.addEventListener('click', (event) => {
			event.stopPropagation();
		});

		overlay.addEventListener('click', () => {
			closeOverlay(overlay, "cancel");
		});
	});
	// Create Room Overlay - Closing from cancel Btn
	document.querySelector('#cancelCreateBtn').addEventListener('click', () => {
		closeOverlay(createRoomDialog, "cancel");
	});
	// Join Room Overlay - Closing from cancel Btn
	document.querySelector('#cancelJoinBtn').addEventListener('click', () => {
		closeOverlay(roomDialog, "cancel");
	});

	// Create Room Overlay - Confirm btn
	document.querySelector('#confirmCreateBtn').addEventListener('click', async () => {
		const roomIdInput = document.querySelector('#create-room-id');
		const enteredRoomId = roomIdInput.value.trim();
		if (!enteredRoomId) {
			alert('Please enter a room ID to create.'); // replace with a message in overlay
			return;
		}

		socket.emit('check-room', { roomId: enteredRoomId }, (res) => {
			if (res.success) return; // Room doesn't exist
		});

		try {
			await initializeCallerPeerConnection();

			const offer = await peerConnection.createOffer();

			// Create Room event before ICE Candidates start generating
			socket.emit('create-room', {
				roomId: enteredRoomId,
				offer: {
					type: offer.type,
					sdp: offer.sdp
				}
			}, async (res) => { // callback sent by the server
				if (res.success) {
					await peerConnection.setLocalDescription(offer); // This starts ICE Candidates generation
					closeOverlay(createRoomDialog, "confirm");
					isCaller = true;
					roomId = enteredRoomId;
					document.querySelector('#currentRoom').innerText = `Current room is ${roomId} - You are the caller!`;
				}
				else throw new Error(res.message);
			});
		} catch (error) {
			console.error('Error creating room:', error);
			alert(`Please try again. ${error}`); // replace with a message in overlay
			closeOverlay(createRoomDialog, "cancel");
			resetConnection();
		}
	});

	// Join Room Overlay - Confirm Btn
	document.querySelector('#confirmJoinBtn').addEventListener('click', async () => {
		const roomIdInput = document.querySelector('#room-id');
		const enteredRoomId = roomIdInput.value.trim();
		if (!enteredRoomId) {
			alert('Please enter a room ID to create.'); // replace with a message in overlay
			return;
		}

		socket.emit('check-room', { roomId: enteredRoomId }, (res) => {
			if (!res.success) return; // Room doesn't exist
		});

		try {
			await initializeCalleePeerConnection();

			socket.emit('join-room', { roomId: enteredRoomId }, (res) => {
				if (res.success) {
					roomId = enteredRoomId;
					closeOverlay(roomDialog, "confirm");
					document.querySelector('#currentRoom').innerText = `Current room is ${roomId} - You are the callee`;
					isCaller = false;
				}
				else throw new Error(res.message);
			});
		} catch (error) {
			console.error('Error joining room:', error);
			alert(`Failed to join room with ID: ${enteredRoomId}`); // replace with a message in overlay
			closeOverlay(roomDialog, "cancel");
			resetConnection();
		}

	});
}

function cameraToggle() {
	const videoTrack = stream.getVideoTracks()[0]; // Target the active camera track
	videoTrack.enabled = !videoTrack.enabled;
	localStream = stream;
}

function populateCameraOptions() {
	const videoTracks = stream.getVideoTracks();
	const currentVideoTrack = videoTracks.find((vT) => vT.enabled === true); // get the active one

	const selectElement = document.querySelector('#videoOptions');
	const existingOptions = selectElement.querySelectorAll('option');
	existingOptions.forEach(option => option.remove()); // Clear existing options

	// getVideoTracks[0] provides id as 'id'
	// enumerateDevices() => videoOptions[0] provides id as 'deviceId'
	videoOptions.forEach((track) => {
		const option = document.createElement('option');
		option.value = track.deviceId;
		option.textContent = track.label;
		if (track.deviceId === currentVideoTrack?.id) option.selected = true;
		selectElement.appendChild(option);
	});
}

function micToggle() {
	const audioTrack = stream.getAudioTracks()[0]; // Target the active audio track
	audioTrack.enabled = !audioTrack.enabled;
	localStream = stream;
}

// Function to close Overlay
function closeOverlay(overlay, action) {
	overlay.classList.add('overlay-hidden');

	if (action === "confirm") {
		document.querySelector('#createBtn').disabled = true;
		document.querySelector('#joinBtn').disabled = true;
		document.querySelector('#hangupBtn').disabled = false;
	}
	else if (action === "cancel") {
		document.querySelector('#createBtn').disabled = false;
		document.querySelector('#joinBtn').disabled = false;
		document.querySelector('#hangupBtn').disabled = true;
	}

	if (overlay.id === 'create-room-dialog') {
		document.querySelector('#create-room-id').value = '';
	}
	else if (overlay.id === 'room-dialog') {
		document.querySelector('#room-id').value = '';
	}
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
			socket.emit('ice-candidate', {
				roomId: roomId,
				candidate: event.candidate.toJSON(),
				isCaller: true
			});
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

async function initializeCalleePeerConnection() {
	console.log('Creating new RTCPeerConnection for callee with config:', CONFIG);

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
			socket.emit('ice-candidate', {
				roomId: roomId,
				candidate: event.candidate.toJSON(),
				isCaller: false
			});
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

// Open user media (camera/mic)
async function openUserMedia() {
	if (hasInitializedMedia) {
		console.log('Media already initialized');
		return;
	}

	try {
		const mediaDevices = navigator.mediaDevices;
		const devices = await mediaDevices.enumerateDevices();
		videoOptions = devices.filter((device) => device.kind === 'videoinput');
		audioOptions = devices.filter((device) => device.kind === 'audioinput');

		stream = await mediaDevices.getUserMedia({ video: true, audio: true });
		document.querySelector('#localVideo').srcObject = stream;
		localStream = stream;
		populateCameraOptions();
		remoteStream = new MediaStream();
		document.querySelector('#remoteVideo').srcObject = remoteStream;

		document.querySelector('#permissionBtn').disabled = true;
		document.querySelector('#createBtn').disabled = false;
		document.querySelector('#joinBtn').disabled = false;
		hasInitializedMedia = true;
	} catch (error) {
		console.error('Error opening user media:', error);
		alert(`Error accessing camera and microphone: ${error.message}`);
		document.querySelector('#permissionBtn').textContent = 'Retry Camera/Mic Access';
		document.querySelector('#permissionBtn').disabled = false;
		document.querySelector('#createBtn').disabled = true;
		document.querySelector('#joinBtn').disabled = true;
	}
}

// Hang up the call
async function hangUp() {
	if (peerConnection) {
		socket.emit('leave-room', {
			roomId: roomId,
			isCaller: isCaller
		});

		resetConnection();
	}

	document.querySelector('#createBtn').disabled = false;
	document.querySelector('#joinBtn').disabled = false;
	document.querySelector('#hangupBtn').disabled = true;
	document.querySelector('#currentRoom').innerText = '';
	roomId = null;
	isCaller = null;
}

function resetConnection() {
	if (peerConnection) {
		peerConnection.close();
		peerConnection = null;
	}
	if (remoteStream) {
		remoteStream.getTracks().forEach(track => track.stop());
		document.querySelector('#remoteVideo').srcObject = null;
		remoteStream = new MediaStream();
		document.querySelector('#remoteVideo').srcObject = remoteStream;
	}

	console.log('Connection reset, ready for new connections');
}

// Register peer connection event listeners
function registerPeerConnectionListeners() {
	peerConnection.addEventListener('icegatheringstatechange', () => {
		console.log(`ICE gathering state changed: ${peerConnection.iceGatheringState}`);
	});

	peerConnection.addEventListener('connectionstatechange', () => {
		console.log(`Connection state change: ${peerConnection.connectionState}`);

		if (peerConnection.connectionState === 'connected') {
			console.log('Peers connected!');
		} else if (peerConnection.connectionState === 'disconnected' ||
			peerConnection.connectionState === 'failed' ||
			peerConnection.connectionState === 'closed') {
			console.log('Peer connection lost or closed');
		}
	});

	peerConnection.addEventListener('signalingstatechange', () => {
		console.log(`Signaling state change: ${peerConnection.signalingState}`);
	});

	peerConnection.addEventListener('iceconnectionstatechange', () => {
		console.log(`ICE connection state change: ${peerConnection.iceConnectionState}`);
	});
}

// Call init when page loads
window.addEventListener('load', init);

