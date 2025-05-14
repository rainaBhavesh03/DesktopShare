# WebRTC Two-Person Video Calling (with Future Plans for Remote Control)

Hi there! 👋 This is a personal project where I'm building a simple two-person video calling app using WebRTC. Right now, it uses a polling mechanism for signaling, but the long-term goal is to add real-time features like screen sharing and remote control, possibly powered by WebSockets.

This project is both a technical exploration and a way for me to better understand real-time peer-to-peer communication.

## What's Working Right Now

- ✅ **Two-person video calls** using WebRTC.
    
- 🔁 **Basic signaling** via polling to exchange session descriptions and ICE candidates.
    
- 🖥️ **Simple UI** with buttons to create or join a call and hang up.
    

> ⚠️ Heads up: The signaling mechanism is still using polling, which isn’t the most efficient. Switching to WebSockets is high on my to-do list.

## Why Remote Control? (And Why It’s Tricky)

Remember how older versions of Skype let you control someone else’s screen? That kind of feature has mostly disappeared, and I’m curious about the reasons behind that. From what I’ve seen, it comes down to:

- 🛡️ **Security concerns:** Remote control opens a lot of potential for abuse if not implemented carefully.
    
- 🔧 **Complexity:** Secure input control over a peer-to-peer connection is hard to get right.
    
- 💻 **OS-level alternatives:** Platforms like Windows and macOS now offer built-in remote support tools.
    
- 🎯 **Shift in priorities:** Most communication tools are now focused more on messaging, calls, and team collaboration.
    

Still, I think it's an exciting challenge worth exploring.

## What I’m Planning Next

Here’s a rough roadmap of where I want to take this:

     
- 🔄 **WebSockets:** Replace polling with a real-time signaling system for a much smoother experience.
     
- 🖥️ **Screen sharing:** Using `getDisplayMedia()` to let users share their screen or an app window.
     
- 🎮 **Remote control:** Eventually, I’d like to allow one user to control the other’s screen input (mouse/keyboard) during screen sharing. That'll likely involve:
        
    - WebRTC **data channels** to send input events.
        
    - Possibly interacting with **OS-level APIs**, if needed.
        
    - Starting small with limited, safe forms of interaction.
     
- 🧪 **More experimentation:** This is a learning project, so I’ll be iterating as I go.
     

## Getting Set Up

### Requirements

Before running the project, make sure you have:

- **Npm + Node.js + ExpressJs**
    
- A **modern browser** (Chrome, Firefox, Safari)
    
- A **webcam + mic** for video/audio communication
    

### 1\. Clone the Repo

```bash
git clone [YOUR_REPOSITORY_URL] cd [YOUR_PROJECT_DIRECTORY]`\
```

### 2\. Configure API URL

You'll need a backend to store and retrieve signaling data. In the frontend (`app.js`), there's a `CONFIG.API_URL` setting:

```js
const CONFIG = {     API_URL: 'http://localhost:3000/api' // Set this to your backend API };
```

You’ll also need to define this config in a separate `config.js` file:

```js
window.CONFIG = {     API_URL: 'http://localhost:3000/api',     ICE_SERVERS: [         { urls: 'stun:stun.l.google.com:19302' },         // Add TURN servers here if needed     ],     ICE_CANDIDATE_POOL_SIZE: 10, };
```

### 3\. Serve the Frontend

You can serve the frontend using any simple static server. Here’s one way with `http-server`:

```bash
npm install -g http-server
npx http-server -p 8080 -c-1
```

Then open the provided URL (usually `http://localhost:8080`) in your browser.

## How to Use It

1. Open the app in **two different browser windows or devices**.
    
2. In one window:
    
    - Click **Create Room**.
        
    - A room ID will appear—share this with the other person.
        
3. In the other window:
    
    - Click **Join Room**, enter the room ID, and click **Join**.
        
4. If all goes well, you’ll see each other’s video streams and can start chatting.
    
5. Click **Hang Up** to end the call.
    

## Notes & Caveats

- ⚠️ **Polling-based signaling** is currently in use. It works but isn’t optimal.
    
- 🌐 **STUN/TURN servers** are necessary for WebRTC to work across networks. Make sure your ICE server config is correct.
    
- 🔄 **Reconnect handling** is basic for now. (Treating state 'disconnected' and 'failed' as "Hang Up")
    
- 📺 **No screen sharing or remote control yet** — these are planned future features.
    

## Roadmap & Future Improvements

Here’s what I’d like to work on next:

- 🔄 Switch to **WebSockets** for real-time signaling
    
- 📺 Add **screen sharing** using `getDisplayMedia()`
    
- 🎮 Explore **remote control** over WebRTC data channels
    
- 🖌️ Improve the **UI/UX**
    
- 🛑 Add better **error handling** and status feedback
    
- 👥 Support **more than two participants**
    
- 🔐 Add security considerations, especially around remote control
    

