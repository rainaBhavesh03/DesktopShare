// server.js - Main backend server file
const express = require('express');
const cors = require('cors');
const https = require('https');
const fs = require('fs');
const dotenv = require('dotenv');
const { Server } = require('socket.io');

// Load environment variables
dotenv.config();

const privateKey = fs.readFileSync('../certificates/key.pem', 'utf8');
const certificate = fs.readFileSync('../certificates/cert.pem', 'utf8');
const credentials = {
	key: privateKey,
	cert: certificate
};

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Websocket
let io = null;

// Start server
const PORT = 4000;
const httpsServer = https.createServer(credentials, app);
io = new Server(httpsServer, {
	cors: {
		origin: "https://192.168.1.7:8080",
	}
});
httpsServer.listen(PORT, () => {
	console.log(`HTTPS server running on https://192.168.1.7:${PORT}`);
});



// Store active rooms
const rooms = new Map();

// Store early ICE candidates
const earlyIceCandidates = new Map();

io.on('connection', (socket) => {
	console.log(`Client connected: ${socket.id}`);

	// Check if room is available
	socket.on('check-room', (data, callback) => {
		const { roomId } = data;
		callback({ success: rooms.has(roomId) });
	});

	// Handle room creation
	socket.on('create-room', (data, callback) => {
		const { roomId, offer } = data;
		if (!roomId || !offer) {
			return callback({ success: false, message: 'Invalid room data' });
		}
		// Recheck if room is available - Resolves race condition wherein multiple clients try to create the same room
		if (rooms.has(roomId)) return callback({ success: false, message: 'Room already exists' });

		// Save the room and join the socket
		rooms.set(roomId, { callerId: socket.id, calleeId: null, offer, lastActivity: Date.now() }); // Track when the room was last active
		earlyIceCandidates.set(roomId, []);
		socket.join(roomId);

		updateRoomActivity(roomId); // Update activity timestamp
		console.log(`Room created: ${roomId} by ${socket.id}`);
		callback({ success: true, roomId });
	});

	// Handle room joining
	socket.on('join-room', (data, callback) => {
		const { roomId } = data;
		// Recheck if room is available - Resolves race condition wherein multiple clients try to create the same room
		if (!rooms.has(roomId)) return callback({ success: false, message: "Room doesn't exist" });

		const room = rooms.get(roomId);
		if (room.calleeId) return callback({ success: false, message: "Room is full" });

		// Update room with callee info
		room.calleeId = socket.id;
		rooms.set(roomId, room);
		socket.join(roomId);

		// Send the stored offer to the callee
		socket.emit('offer', {
			roomId,
			offer: room.offer
		});

		// Send any stored early ICE candidates to the callee
		if (earlyIceCandidates.has(roomId)) {
			const candidates = earlyIceCandidates.get(roomId);
			candidates.forEach(candidate => {
				socket.emit('ice-candidate', {
					roomId,
					candidate
				});
			});
		}

		updateRoomActivity(roomId); // Update activity timestamp
		console.log(`Client ${socket.id} joined room: ${roomId}`);
		callback({ success: true, message: `Joined room: ${roomId}` });
	});

	// Handle answer from callee
	socket.on('answer', (data) => {
		const { roomId, answer } = data;

		const room = rooms.get(roomId);
		socket.to(room.callerId).emit('answer', { // Forward the answer to the caller
			roomId,
			answer
		});

		updateRoomActivity(roomId); // Update activity timestamp
	});

	// Handle ICE candidates
	socket.on('ice-candidate', (data) => {
		const { roomId, candidate, isCaller } = data;
		if (!rooms.has(roomId)) return;

		const room = rooms.get(roomId);
		if (isCaller) {
			if (room.calleeId) { // Forward caller's ICE candidate to callee if present
				socket.to(room.calleeId).emit('ice-candidate', {
					roomId,
					candidate
				});
			} else {
				if (earlyIceCandidates.has(roomId)) { // Store early ICE candidates until callee joins
					earlyIceCandidates.get(roomId).push(candidate);
				}
			}
		} else {
			socket.to(room.callerId).emit('ice-candidate', { // Forward callee's ICE candidate to caller
				roomId,
				candidate
			});
		}

		updateRoomActivity(roomId); // Update activity timestamp
	});

	// Update offer for roomId
	socket.on('update-room-offer', (data, callback) => {
		const { roomId, offer } = data;
		if (!roomId || !offer) {
			return callback({ success: false, message: 'Invalid room data' });
		}

		// Check if room exists and this socket is the caller
		if (!rooms.has(roomId)) return callback({ success: false, message: 'Room does not exist' });
		const room = rooms.get(roomId);
		if (room.callerId !== socket.id) return callback({ success: false, message: 'Only the caller can update the room offer' });

		room.offer = offer;
		room.calleeId = null;
		updateRoomActivity(roomId); // Update activity timestamp

		// Clear any early ICE candidates as they're no longer valid with new offer
		if (earlyIceCandidates.has(roomId)) {
			earlyIceCandidates.set(roomId, []);
		}

		callback({ success: true });
	});

	// Handle disconnection or leaving a room
	socket.on('leave-room', (data) => {
		const { roomId, isCaller } = data;
		handleDisconnection(socket, roomId, isCaller);
	});

	socket.on('disconnect', () => {
		console.log(`Client disconnected: ${socket.id}`);

		// Find any rooms this socket is part of
		rooms.forEach((room, roomId) => {
			if (room.callerId === socket.id) {
				handleDisconnection(socket, roomId, true);
			} else if (room.calleeId === socket.id) {
				handleDisconnection(socket, roomId, false);
			}
		});
	});
});

function handleDisconnection(socket, roomId, isCaller) {
	if (!rooms.has(roomId)) return;

	const room = rooms.get(roomId);
	if (isCaller) {
		// If caller leaves, notify callee and delete the room
		if (room.calleeId) io.to(room.calleeId).emit('user-disconnected', { roomId });
		rooms.delete(roomId);
		// Clean up stored ICE candidates
		if (earlyIceCandidates.has(roomId)) {
			earlyIceCandidates.delete(roomId);
		}
		console.log(`Room ${roomId} deleted because caller left`);
	} else {
		// If callee leaves, update the room and notify caller
		if (room.callerId) io.to(room.callerId).emit('user-disconnected', { roomId });
		// Keep the room for reconnection, just remove callee
		room.calleeId = null;
		rooms.set(roomId, room);
		console.log(`Callee left room ${roomId}`);
	}
	socket.leave(roomId);
	updateRoomActivity(roomId); // Update activity timestamp
}





//********* THE IMPLEMENTATION BELOW IS INCOMPLETE AND NEEDS TESTING *******


// Update room active timestamp
// This is incomplete as even a room with peers simply talking is an activity.
// Inactivity is when the room is empty
function updateRoomActivity(roomId) {
	if (rooms.has(roomId)) {
		const room = rooms.get(roomId);
		room.lastActivity = Date.now();
		rooms.set(roomId, room);
		console.log('Room activity updated:', roomId);
	}
}

// Periodically clean up stale rooms (e.g., every 5 minutes)
// This is incomplete as it doesn't hangup the peers in the room before deleting the room itself
setInterval(() => {
	const staleTime = 3600000; // 1 hour in milliseconds
	const now = Date.now();

	rooms.forEach((room, roomId) => {
		// Add lastActivity timestamp to your room objects
		if (room.lastActivity && (now - room.lastActivity > staleTime)) {
			console.log(`Cleaning up stale room: ${roomId}`);
			rooms.delete(roomId);

			if (earlyIceCandidates.has(roomId)) {
				earlyIceCandidates.delete(roomId);
			}
		}
	});
}, 300000); // Run every 5 minutes
