// server.js - Main backend server file
const express = require('express');
const cors = require('cors');
const { MongoClient, ObjectId } = require('mongodb');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT;

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB Connection
const mongoUri = process.env.MONGO_URI;
const dbName = process.env.DBNAME;
const roomsCollectionName = process.env.COLLNAME;

let dbClient;
let roomsCollection;

async function connectToDatabase() {
	try {
		dbClient = new MongoClient(mongoUri);
		await dbClient.connect();
		const db = dbClient.db(dbName);
		roomsCollection = db.collection(roomsCollectionName);
		console.log('Connected to MongoDB Atlas');
		return true;
	} catch (error) {
		console.error('Failed to connect to MongoDB Atlas:', error);
		return false;
	}
}

// API Routes

// Create a new room
app.post('/api/rooms', async (req, res) => {
	try {
		const roomWithOffer = {
			offer: req.body.offer,
			answer: null,
			callerCandidates: [],
			calleeCandidates: []
		};

		const result = await roomsCollection.insertOne(roomWithOffer);
		res.status(201).json({ roomId: result.insertedId.toString() });
	} catch (error) {
		console.error('Error creating room:', error);
		res.status(500).json({ error: 'Failed to create room' });
	}
});

// Get room by ID
app.get('/api/rooms/:roomId', async (req, res) => {
	try {
		const roomId = req.params.roomId;
		const roomDocument = await roomsCollection.findOne({ _id: new ObjectId(roomId) });

		if (roomDocument) {
			res.status(200).json(roomDocument);
		} else {
			res.status(404).json({ error: 'Room not found' });
		}
	} catch (error) {
		console.error('Error getting room:', error);
		res.status(500).json({ error: 'Failed to get room' });
	}
});

// Add answer to room
app.post('/api/rooms/:roomId/answer', async (req, res) => {
	try {
		const roomId = req.params.roomId;
		const answer = req.body.answer;

		await roomsCollection.updateOne(
			{ _id: new ObjectId(roomId) },
			{ $set: { answer: answer } }
		);

		res.status(200).json({ success: true });
	} catch (error) {
		console.error('Error adding answer:', error);
		res.status(500).json({ error: 'Failed to add answer' });
	}
});

// Update offer to room
app.patch('/api/rooms/:roomId/offer', async (req, res) => {
	try {
		const roomId = req.params.roomId;
		const offer = req.body.offer;

		await roomsCollection.updateOne(
			{ _id: new ObjectId(roomId) },
			{ $set: { offer: offer } }
		);

		res.status(200).json({ success: true });
	} catch (error) {
		console.error('Error updating offer:', error);
		res.status(500).json({ error: 'Failed to update offer' });
	}
});

// Add ICE candidate
app.post('/api/rooms/:roomId/callerCandidates', async (req, res) => {
	try {
		const roomId = req.params.roomId;
		const candidate = req.body.candidate;

		await roomsCollection.updateOne(
			{ _id: new ObjectId(roomId) },
			{ $push: { callerCandidates: candidate } }
		);

		res.status(200).json({ success: true });
	} catch (error) {
		console.error('Error adding caller candidate:', error);
		res.status(500).json({ error: 'Failed to add caller candidate' });
	}
});

app.post('/api/rooms/:roomId/calleeCandidates', async (req, res) => {
	try {
		const roomId = req.params.roomId;
		const candidate = req.body.candidate;

		await roomsCollection.updateOne(
			{ _id: new ObjectId(roomId) },
			{ $push: { calleeCandidates: candidate } }
		);

		res.status(200).json({ success: true });
	} catch (error) {
		console.error('Error adding callee candidate:', error);
		res.status(500).json({ error: 'Failed to add callee candidate' });
	}
});

// Get all caller candidates
app.get('/api/rooms/:roomId/callerCandidates', async (req, res) => {
	try {
		const roomId = req.params.roomId;
		const roomDocument = await roomsCollection.findOne({ _id: new ObjectId(roomId) });

		if (roomDocument && roomDocument.callerCandidates) {
			res.status(200).json({ candidates: roomDocument.callerCandidates });
		} else {
			res.status(404).json({ error: 'Room or candidates not found' });
		}
	} catch (error) {
		console.error('Error getting caller candidates:', error);
		res.status(500).json({ error: 'Failed to get caller candidates' });
	}
});

// Get all callee candidates
app.get('/api/rooms/:roomId/calleeCandidates', async (req, res) => {
	try {
		const roomId = req.params.roomId;
		const roomDocument = await roomsCollection.findOne({ _id: new ObjectId(roomId) });

		if (roomDocument && roomDocument.calleeCandidates) {
			res.status(200).json({ candidates: roomDocument.calleeCandidates });
		} else {
			res.status(404).json({ error: 'Room or candidates not found' });
		}
	} catch (error) {
		console.error('Error getting callee candidates:', error);
		res.status(500).json({ error: 'Failed to get callee candidates' });
	}
});

// Delete room
app.delete('/api/rooms/:roomId', async (req, res) => {
	try {
		const roomId = req.params.roomId;
		await roomsCollection.deleteOne({ _id: new ObjectId(roomId) });
		res.status(200).json({ success: true });
	} catch (error) {
		console.error('Error deleting room:', error);
		res.status(500).json({ error: 'Failed to delete room' });
	}
});

// Reset answer when callee leaves
app.patch('/api/rooms/:roomId/resetForCalleeLeave', async (req, res) => {
	const roomId = req.params.roomId;
	try {
		await roomsCollection.updateOne(
			{ _id: new ObjectId(roomId) },
			{ $unset: { answer: null, calleeCandidates: [] } }
		);

		res.status(200).json({ message: "Room reset for callee rejoin." });
	} catch (err) {
		res.status(500).json({ error: "Failed to reset room." });
	}
});

// Start server
async function startServer() {
	const dbConnected = await connectToDatabase();

	if (dbConnected) {
		app.listen(PORT, () => {
			console.log(`Server running on port ${PORT}`);
		});
	} else {
		console.error('Failed to start server due to database connection issues');
		process.exit(1);
	}
}

startServer();

// Handle graceful shutdown
process.on('SIGINT', async () => {
	console.log('Shutting down server...');
	if (dbClient) {
		await dbClient.close();
		console.log('Database connection closed');
	}
	process.exit(0);
});
