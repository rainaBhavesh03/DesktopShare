# WebRTC Two-Person Video Calling

👋 Welcome to my WebRTC project! I'm building a simple two-person video calling app with WebRTC, with plans to add screen sharing and remote control features. This project has recently been upgraded to use WebSockets (Socket.io) for signaling instead of polling.

## ✨ Current Features

- ✅ **Two-person video calls** using WebRTC peer connections
- 🔄 **Real-time signaling** via Socket.io WebSockets
- 🛠️ **Room management** with create/join functionality
- 🔄 **Reconnection handling** when participants disconnect
- 🖥️ **Clean, intuitive UI** for call management

> **Update:** Polling has been replaced with Socket.io WebSockets for more efficient, real-time signaling!

## 🚀 Why Remote Control? (And Why It's Challenging)

Remember when Skype and other apps let you control someone else's computer? This feature has become increasingly rare due to:

- 🛡️ **Security concerns:** Remote control introduces significant security risks
- 🔧 **Technical complexity:** Implementing secure input control over P2P is challenging
- 💻 **OS alternatives:** Most operating systems now offer built-in remote assistance tools
- 🎯 **Shifting priorities:** Modern communication tools focus on meetings and messaging

Despite these challenges, I believe there's value in exploring this functionality as a learning experience.

## 🗺️ Roadmap

Here's what I'm planning to work on:

- [x] Replace polling with WebSockets for signaling
- [ ] Implement screen sharing via `getDisplayMedia()`
- [ ] Create data channels for text chat and control signals
- [ ] Design and implement remote control functionality
- [ ] Enhance UI/UX with connection status indicators
- [ ] Improve error handling and user feedback
- [ ] Add support for room persistence
- [ ] Explore multi-participant calls (3+ users)
- [ ] Implement security best practices for remote control

## 🛠️ Setup Instructions

### Prerequisites

- Node.js and npm installed
- Modern browser with WebRTC support (Chrome, Firefox, Edge, Safari)
- Webcam and microphone for video/audio
- SSL certificates for local development (WebRTC requires HTTPS)

### 1. Clone the Repository

```bash
git clone [YOUR_REPOSITORY_URL]
cd [YOUR_PROJECT_DIRECTORY]
```

### 2. Install Dependencies

```bash
# Install server dependencies
npm install
```

### 3. Configure WebSocket Server

Create or modify your config files:

```javascript
// config.js for client
window.CONFIG = {
    WEBSOCKET_URL: 'wss://localhost:4000',  // Update with your server address
    ICE_SERVERS: [
        { urls: 'stun:stun.l.google.com:19302' },
        // Add TURN servers for NAT traversal in production
    ],
    ICE_CANDIDATE_POOL_SIZE: 10,
};
```

### 4. Generate SSL Certificates (for development)

WebRTC requires HTTPS, even for local development:

```bash
# Using OpenSSL to generate self-signed certificates
mkdir -p certs
openssl req -x509 -nodes -days 365 -newkey rsa:2048 -keyout certs/key.pem -out certs/cert.pem
```

### 5. Start the Server

```bash
# Start WebSocket signaling server
node server.js
```

### 6. Serve the Frontend

```bash
# Using any static file server (example with http-server)
npx http-server -p 8080 --ssl --cert certs/cert.pem --key certs/key.pem
```

Then open `https://localhost:8080` in your browser (accept the self-signed certificate warning).

## 📱 How to Use

1. **Access the app** in two different browser windows or devices
2. **Allow camera/microphone access** when prompted
3. In the first window:
   - Click **Create Room**
   - Enter a room ID or use the generated one
   - Share the room ID with the second participant
4. In the second window:
   - Click **Join Room**
   - Enter the room ID from the first participant
5. You should now see both video streams and be connected
6. Click **Hang Up** to end the call
