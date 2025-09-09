const path = require("path");
const { app, ipcMain, desktopCapturer, screen: mainScreen } = require("electron");
const serve = require("electron-serve");
const { createWindow: createMainWindow } = require("./helpers");
const { WebSocketServer, WebSocket } = require("ws");
const robot = require("@jitsi/robotjs");
// WebSocket server for signaling
let wss = null;
const sessions = new Map();
const isProd = process.env.NODE_ENV === "production" || app.isPackaged;
if (isProd) {
    serve({ directory: "app" });
}
else {
    app.setPath("userData", `${app.getPath("userData")} (development)`);
}
// Initialize WebSocket server
function initializeWebSocketServer() {
    try {
        wss = new WebSocketServer({ port: 8080 });
        console.log("✅ WebSocket signaling server started on port 8080");
        wss.on("connection", (ws) => {
            console.log("🔌 New WebSocket connection established");
            ws.on("message", (data) => {
                try {
                    const message = JSON.parse(data.toString());
                    handleWebSocketMessage(ws, message);
                }
                catch (error) {
                    console.error("❌ Error parsing WebSocket message:", error);
                }
            });
            ws.on("close", () => {
                console.log("🔌 WebSocket connection closed");
                // Clean up any sessions this connection was part of
                cleanupDisconnectedClient(ws);
            });
        });
        wss.on("error", (error) => {
            console.error("❌ WebSocket server error:", error);
        });
    }
    catch (error) {
        console.log("⚠️ WebSocket server already running on port 8080");
    }
}
// Handle WebSocket messages
function handleWebSocketMessage(ws, message) {
    // Optimized: Only log non-frequent message types
    if (!["mouse_move"].includes(message.type)) {
        console.log("📨 Received message:", message.type);
    }
    switch (message.type) {
        case "create_session":
            handleCreateSession(ws, message);
            break;
        case "join_session":
            handleJoinSession(ws, message);
            break;
        case "leave_session":
            handleLeaveSession(ws, message);
            break;
        case "cleanup_session":
            handleCleanupSession(ws, message);
            break;
        case "offer":
        case "answer":
        case "ice_candidate":
            handleSignalingMessage(ws, message);
            break;
        case "mouse_move":
        case "mouse_click":
        case "mouse_down":
        case "mouse_up":
        case "key_down":
        case "key_up":
        case "screen_resolution":
            handleControlMessage(ws, message);
            break;
        default:
            console.warn("⚠️ Unknown message type:", message.type);
    }
}
// Handle session creation
function handleCreateSession(ws, message) {
    const { sessionId } = message;
    if (sessions.has(sessionId)) {
        ws.send(JSON.stringify({
            type: "session_error",
            sessionId,
            error: "Session already exists",
        }));
        return;
    }
    sessions.set(sessionId, {
        host: ws,
        clients: new Map(),
        createdAt: new Date(),
    });
    console.log("✅ Session created:", sessionId);
    ws.send(JSON.stringify({
        type: "session_created",
        sessionId,
    }));
}
// Handle session joining
function handleJoinSession(ws, message) {
    const { sessionId, clientId } = message;
    const session = sessions.get(sessionId);
    if (!session) {
        ws.send(JSON.stringify({
            type: "session_error",
            sessionId,
            error: "Session not found",
        }));
        return;
    }
    session.clients.set(clientId, ws);
    console.log("✅ Client joined session:", sessionId, "Client:", clientId);
    ws.send(JSON.stringify({
        type: "session_joined",
        sessionId,
        clientId,
    }));
    // Notify host about new client
    if (session.host) {
        session.host.send(JSON.stringify({
            type: "client_joined",
            sessionId,
            clientId,
        }));
    }
}
// Handle session leaving
function handleLeaveSession(ws, message) {
    const { sessionId, clientId } = message;
    const session = sessions.get(sessionId);
    if (!session)
        return;
    if (session.host === ws) {
        // Host is leaving
        console.log("🔌 Host leaving session:", sessionId);
        session.clients.forEach((clientWs) => {
            clientWs.send(JSON.stringify({
                type: "host_disconnected",
                sessionId,
            }));
        });
        sessions.delete(sessionId);
    }
    else {
        // Client is leaving
        session.clients.delete(clientId);
        console.log("🔌 Client leaving session:", sessionId, "Client:", clientId);
        if (session.host) {
            session.host.send(JSON.stringify({
                type: "client_left",
                sessionId,
                clientId,
            }));
        }
    }
}
// Handle session cleanup (for logout scenarios)
function handleCleanupSession(ws, message) {
    const { sessionId, reason } = message;
    const session = sessions.get(sessionId);
    if (!session) {
        console.log("🔌 Session cleanup requested for non-existent session:", sessionId);
        return;
    }
    console.log("🔌 Cleaning up session:", sessionId, "Reason:", reason);
    // Notify all clients that the session is being terminated
    session.clients.forEach((clientWs) => {
        try {
            clientWs.send(JSON.stringify({
                type: "session_terminated",
                sessionId,
                reason: "host_logout",
            }));
        }
        catch (error) {
            console.error("Error notifying client of session termination:", error);
        }
    });
    // Notify host that session is being cleaned up
    if (session.host) {
        try {
            session.host.send(JSON.stringify({
                type: "session_terminated",
                sessionId,
                reason: "host_logout",
            }));
        }
        catch (error) {
            console.error("Error notifying host of session termination:", error);
        }
    }
    // Remove the session from the sessions map
    sessions.delete(sessionId);
    console.log("✅ Session cleaned up:", sessionId);
}
// Handle signaling messages (offer, answer, ICE candidates)
function handleSignalingMessage(ws, message) {
    const { sessionId, clientId } = message;
    const session = sessions.get(sessionId);
    if (!session)
        return;
    if (session.host === ws) {
        // Message from host to specific client
        const clientWs = session.clients.get(clientId);
        if (clientWs) {
            clientWs.send(JSON.stringify(message));
        }
    }
    else {
        // Message from client to host
        if (session.host) {
            session.host.send(JSON.stringify(message));
        }
    }
}
// Handle control messages (mouse, keyboard, screen resolution)
function handleControlMessage(ws, message) {
    const { sessionId, clientId } = message;
    const session = sessions.get(sessionId);
    if (!session)
        return;
    if (session.host === ws) {
        // Control message from host to clients
        session.clients.forEach((clientWs) => {
            clientWs.send(JSON.stringify(message));
        });
    }
    else {
        // Control message from client to host
        if (session.host) {
            session.host.send(JSON.stringify(message));
        }
    }
}
// Clean up disconnected clients
function cleanupDisconnectedClient(ws) {
    sessions.forEach((session, sessionId) => {
        if (session.host === ws) {
            console.log("🔌 Host disconnected from session:", sessionId);
            session.clients.forEach((clientWs) => {
                clientWs.send(JSON.stringify({
                    type: "host_disconnected",
                    sessionId,
                }));
            });
            sessions.delete(sessionId);
            return;
        }
        session.clients.forEach((clientWs, clientId) => {
            if (clientWs === ws) {
                console.log("🔌 Client disconnected from session:", sessionId, "Client:", clientId);
                session.clients.delete(clientId);
                if (session.host) {
                    session.host.send(JSON.stringify({
                        type: "client_left",
                        sessionId,
                        clientId,
                    }));
                }
                return;
            }
        });
    });
}
(async () => {
    await app.whenReady();
    // Start WebSocket server
    initializeWebSocketServer();
    const electronRole = process.env.ELECTRON_ROLE || "default";
    const windowTitle = electronRole === "host"
        ? "DeskViewer - Host"
        : electronRole === "client"
            ? "DeskViewer - Client"
            : "DeskViewer";
    const mainWindow = createMainWindow("main", {
        width: 1200,
        height: 800,
        title: windowTitle,
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            nodeIntegration: false,
            contextIsolation: true,
            webSecurity: false,
            allowRunningInsecureContent: true,
        },
    });
    if (isProd) {
        const roleParam = electronRole !== "default" ? `?role=${electronRole}` : "";
        // Use electron-serve to serve the static files
        await mainWindow.loadURL(`app://./${roleParam}`);
    }
    else {
        const port = process.argv[2];
        const roleParam = electronRole !== "default" ? `?role=${electronRole}` : "";
        await mainWindow.loadURL(`http://localhost:${port}/${roleParam}`);
        mainWindow.webContents.openDevTools();
    }
    // Handle client-side routing
    mainWindow.webContents.on("will-navigate", (event, navigationUrl) => {
        const parsedUrl = new URL(navigationUrl);
        const pathname = parsedUrl.pathname;
        // Allow navigation to our app routes
        if (pathname === "/" ||
            pathname === "/home" ||
            pathname === "/host" ||
            pathname === "/client") {
            return;
        }
        // Prevent navigation to external URLs
        event.preventDefault();
    });
})();
app.on("window-all-closed", () => {
    // Clean up WebSocket server
    if (wss) {
        wss.close();
        console.log("🔌 WebSocket server closed");
    }
    app.quit();
});
ipcMain.on("message", async (event, arg) => {
    event.reply("message", `${arg} World!`);
});
// Handle screen capture permission
ipcMain.handle("get-display-media", async () => {
    const sources = await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: { width: 1920, height: 1080 },
    });
    return sources;
});
// Handle mouse control (optimized for performance)
ipcMain.handle("mouse-move", async (event, x, y) => {
    try {
        // Fast mouse move without logging for better performance
        robot.moveMouse(Math.round(x), Math.round(y));
        return { success: true };
    }
    catch (error) {
        console.error("❌ MAIN: Mouse move error:", error);
        return { success: false, error: error.message };
    }
});
ipcMain.handle("mouse-click", async (event, x, y, button = "left") => {
    try {
        // Remove delay for faster clicks
        robot.moveMouse(Math.round(x), Math.round(y));
        robot.mouseClick(button === "right" ? "right" : "left");
        return { success: true };
    }
    catch (error) {
        console.error("❌ MAIN: Mouse click error:", error);
        return { success: false, error: error.message };
    }
});
ipcMain.handle("mouse-down", async (event, x, y, button = "left") => {
    try {
        robot.moveMouse(Math.round(x), Math.round(y));
        robot.mouseToggle("down", button === "right" ? "right" : "left");
        return { success: true };
    }
    catch (error) {
        console.error("Mouse down error:", error);
        return { success: false, error: error.message };
    }
});
ipcMain.handle("mouse-up", async (event, x, y, button = "left") => {
    try {
        robot.moveMouse(Math.round(x), Math.round(y));
        robot.mouseToggle("up", button === "right" ? "right" : "left");
        return { success: true };
    }
    catch (error) {
        console.error("Mouse up error:", error);
        return { success: false, error: error.message };
    }
});
// Get screen resolution
ipcMain.handle("get-screen-resolution", async () => {
    try {
        const primaryDisplay = mainScreen.getPrimaryDisplay();
        const { width, height } = primaryDisplay.size;
        return { width, height };
    }
    catch (error) {
        console.error("Get screen resolution error:", error);
        return { width: 1920, height: 1080 }; // fallback
    }
});
// Handle keyboard control
ipcMain.handle("key-tap", async (event, key, modifiers) => {
    try {
        if (modifiers && modifiers.length > 0) {
            robot.keyTap(key, modifiers);
        }
        else {
            robot.keyTap(key);
        }
        return { success: true };
    }
    catch (error) {
        console.error("❌ MAIN: Key tap error:", error);
        return { success: false, error: error.message };
    }
});
ipcMain.handle("key-toggle", async (event, key, down, modifiers) => {
    try {
        const state = down ? "down" : "up";
        if (modifiers && modifiers.length > 0) {
            robot.keyToggle(key, state, modifiers);
        }
        else {
            robot.keyToggle(key, state);
        }
        return { success: true };
    }
    catch (error) {
        console.error("❌ MAIN: Key toggle error:", error);
        return { success: false, error: error.message };
    }
});
