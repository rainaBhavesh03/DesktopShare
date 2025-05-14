const mongoose = require("mongoose");

const Rooms = new mongoose.Schema({
	"offer": { "type": String, "sdp": String },
	"answer": { "type": String, "sdp": String },
	"callerCandidates": [{ "candidate": String, "sdpMid": String, "sdpMLineIndex": Number }],
	"calleeCandidates": [{ "candidate": String, "sdpMid": String, "sdpMLineIndex": Number }]
})

module.exports = mongoose.model("Rooms", Rooms);
