# DeskViewer - Remote Desktop Application

A complete remote desktop application built with Nextron (Next.js + Electron) that provides screen sharing and remote control capabilities.

## Features

- **Screen Sharing**: Share your screen with remote clients
- **Mouse Control**: Remote mouse control with click and drag support
- **Keyboard Control**: Remote keyboard input with modifier key support
- **Fullscreen Mode**: AnyDesk-like fullscreen experience
- **Windowed Mode**: Multitasking support with windowed view
- **Real-time Communication**: WebRTC-based peer-to-peer streaming
- **Professional UI**: Modern, responsive interface

## Tech Stack

- **Frontend**: Next.js, React, TypeScript, Tailwind CSS
- **Desktop**: Electron
- **Remote Control**: robotjs (@jitsi/robotjs)
- **Real-time**: WebRTC, WebSocket
- **Signaling**: Custom WebSocket server

## Getting Started

### Prerequisites

- Node.js 16+ 
- npm or yarn

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd deskviewer

# Install dependencies
npm install
```

### Quick Start

```bash
# Start the application (WebSocket server starts automatically)
npm run dev
```

The WebSocket signaling server is now built into the application and starts automatically when you launch DeskViewer.

## Usage

### Starting the Application

Simply start the DeskViewer application:
```bash
npm run dev
```

The WebSocket signaling server starts automatically with the application.

### Host Mode (Screen Sharing)

1. Click "Host" in the application
2. Click "Start Sharing" to begin screen sharing
3. Share the generated Session ID with clients
4. Allow remote control when prompted

### Client Mode (Remote Control)

1. Click "Client" in the application
2. Enter the Session ID provided by the host
3. Click "Connect" to join the session
4. Use mouse and keyboard to control the remote computer

### Important Notes

- **Self-Contained**: No separate server setup required
- **Session ID**: Unique identifier for each sharing session
- **Permissions**: Allow screen sharing and remote control when prompted
- **Network**: Both host and client must be on the same network or have proper port forwarding

## Architecture

### Components

- **WebSocket Server** (`websocket-server.js`): Signaling server for WebRTC
- **Host Application**: Screen capture and remote control receiver
- **Client Application**: Remote control interface and stream viewer
- **WebRTC Manager** (`renderer/utils/webrtc.ts`): WebRTC connection management

### Communication Flow

1. **Signaling**: WebSocket server handles session creation and WebRTC signaling
2. **Screen Capture**: Host captures screen using Electron's `desktopCapturer`
3. **Streaming**: WebRTC peer-to-peer connection for real-time video
4. **Remote Control**: Mouse/keyboard events sent via WebSocket to host
5. **Control Execution**: Host uses robotjs to simulate mouse/keyboard actions

## Development

### Project Structure

```
deskviewer/
├── main/                 # Electron main process
│   ├── background.ts    # Main process entry point
│   └── preload.ts       # Preload script for IPC
├── renderer/            # Next.js frontend
│   ├── pages/          # React pages
│   ├── utils/          # Utilities (WebRTC, etc.)
│   └── styles/         # CSS styles
├── websocket-server.js  # Signaling server
└── package.json         # Dependencies and scripts
```

### Key Files

- **`main/background.ts`**: Electron main process with IPC handlers
- **`renderer/pages/host.tsx`**: Host UI and screen sharing logic
- **`renderer/pages/client.tsx`**: Client UI and remote control
- **`renderer/utils/webrtc.ts`**: WebRTC connection management
- **`websocket-server.js`**: WebSocket signaling server

## Features in Detail

### Screen Sharing
- Uses Electron's `desktopCapturer` for screen capture
- WebRTC peer-to-peer streaming for low latency
- Support for multiple displays

### Mouse Control
- Relative coordinate mapping between client and host
- Support for left, right, and middle mouse buttons
- Real-time cursor movement and clicking

### Keyboard Control
- Full keyboard support including special keys
- Modifier key combinations (Ctrl, Shift, Alt, Meta)
- Key mapping from browser events to robotjs

### View Modes
- **Windowed**: Small window for multitasking
- **Fullscreen**: Immersive AnyDesk-like experience
- Seamless switching between modes

## Troubleshooting

### Common Issues

1. **Connection Failed**: Ensure WebSocket server is running
2. **Screen Not Visible**: Check firewall settings and network connectivity
3. **Mouse/Keyboard Not Working**: Verify robotjs installation
4. **Performance Issues**: Check network bandwidth and computer resources

## License

This project is licensed under the MIT License.
