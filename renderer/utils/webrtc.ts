export interface SignalingMessage {
  type: string;
  sessionId?: string;
  clientId?: string;
  data?: any;
  offer?: RTCSessionDescriptionInit;
  answer?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
  mouseData?: {
    x: number;
    y: number;
    button?: "left" | "right" | "middle";
  };
  keyboardData?: {
    key: string;
    code: string;
    ctrlKey: boolean;
    shiftKey: boolean;
    altKey: boolean;
    metaKey: boolean;
  };
  resolution?: {
    width: number;
    height: number;
  };
  granted?: boolean;
  reason?: string;
}

export class WebRTCManager {
  private peerConnection: RTCPeerConnection | null = null;
  private ws: WebSocket | null = null;
  private sessionId: string = "";
  private clientId: string = "";
  private isHost: boolean = false;
  private onStreamReceived?: (stream: MediaStream) => void;
  private onConnectionStateChange?: (state: string) => void;
  private onMouseEvent?: (
    mouseData: { x: number; y: number; button?: string },
    type: string
  ) => void;
  private onKeyboardEvent?: (
    keyboardData: {
      key: string;
      code: string;
      ctrlKey: boolean;
      shiftKey: boolean;
      altKey: boolean;
      metaKey: boolean;
    },
    type: string
  ) => void;
  private onScreenResolution?: (resolution: {
    width: number;
    height: number;
  }) => void;
  private onPermissionRequest?: (clientId: string, sessionId: string) => void;
  private onPermissionResponse?: (granted: boolean) => void;
  private onDisconnectionReason?: (reason: string) => void;

  constructor() {
    this.setupPeerConnection();
  }

  private setupPeerConnection() {
    // Close existing connection if any
    if (this.peerConnection) {
      this.peerConnection.close();
    }

    // Optimized configuration for low latency
    const configuration: RTCConfiguration = {
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      iceCandidatePoolSize: 5, // Reduced for faster connection
      bundlePolicy: "max-bundle", // Optimize for single connection
      rtcpMuxPolicy: "require", // Force RTCP multiplexing
      iceTransportPolicy: "all",
    };

    this.peerConnection = new RTCPeerConnection(configuration);

    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        // Optimized: Only send ICE candidates when connection is not established
        if (this.peerConnection?.connectionState !== "connected") {
          this.sendSignalingMessage({
            type: "ice_candidate",
            sessionId: this.sessionId,
            clientId: this.isHost ? "" : this.clientId,
            data: event.candidate,
          });
        }
      }
    };

    this.peerConnection.onconnectionstatechange = () => {
      const state = this.peerConnection?.connectionState;

      if (state === "failed" || state === "disconnected") {
        // If we're a client and the connection fails, it likely means the host disconnected
        if (!this.isHost) {
          this.onDisconnectionReason?.(
            "Connection lost - host may have disconnected"
          );
        }
      }

      this.onConnectionStateChange?.(state || "unknown");
    };

    this.peerConnection.ontrack = (event) => {
      if (event.streams && event.streams[0]) {
        this.onStreamReceived?.(event.streams[0]);
      }
    };
  }

  // Method to reinitialize the peer connection for role reversal scenarios
  public reinitializePeerConnection() {
    this.setupPeerConnection();
  }

  public async startHost(
    sessionId: string,
    stream: MediaStream | null = null
  ): Promise<void> {
    this.sessionId = sessionId;
    this.isHost = true;
    this.clientId = "host";

    await this.connectWebSocket();
    await this.createSession();

    // Only add stream if provided (for backward compatibility)
    if (stream) {
      await this.addStreamToPeerConnection(stream);
    }
  }

  public async startClient(sessionId: string): Promise<void> {
    this.sessionId = sessionId;
    this.isHost = false;
    this.clientId = `client_${Math.random().toString(36).substr(2, 9)}`;

    await this.connectWebSocket();
    await this.joinSession();
  }

  private async connectWebSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Close existing WebSocket if any
      if (this.ws) {
        this.ws.close();
        this.ws = null;
      }

      // Use local WebSocket server for Electron app, fallback to environment variable
      const wsUrl = process.env.NEXT_PUBLIC_WEBSOCKET_URL || 'ws://localhost:8080';

      this.ws = new WebSocket(wsUrl);

      // Keep-alive mechanism
      let keepAliveInterval: NodeJS.Timeout | null = null;
      let lastPongReceived = Date.now();

      // Set timeout for connection
      const connectionTimeout = setTimeout(() => {
        if (this.ws) {
          this.ws.close();
          this.ws = null;
        }
        if (keepAliveInterval) {
          clearInterval(keepAliveInterval);
        }
        reject(new Error("WebSocket connection timeout"));
      }, 10000); // 10 second timeout

      this.ws.onopen = () => {
        clearTimeout(connectionTimeout);
        
        // Start client-side keep-alive (send ping every 25 seconds)
        keepAliveInterval = setInterval(() => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            try {
              this.ws.send(JSON.stringify({ 
                type: "ping", 
                timestamp: Date.now() 
              }));
              console.log("💓 Sent client ping to keep connection alive");
            } catch (error) {
              console.error("❌ Error sending client ping:", error);
            }
          }
        }, 25000); // 25 seconds

        resolve();
      };

      this.ws.onerror = (error) => {
        clearTimeout(connectionTimeout);
        if (keepAliveInterval) {
          clearInterval(keepAliveInterval);
        }
        console.error("❌ WebSocket connection error:", error);
        reject(
          new Error(
            "Failed to connect to WebSocket server. Please check your network connection and server availability."
          )
        );
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          
          // Handle pong responses from server
          if (message.type === "pong") {
            lastPongReceived = Date.now();
            console.log("💓 Received pong from server - connection is alive");
            return;
          }
          
          this.handleSignalingMessage(message);
        } catch (error) {
          console.error("Error parsing WebSocket message:", error);
        }
      };

      this.ws.onclose = (event) => {
        clearTimeout(connectionTimeout);
        if (keepAliveInterval) {
          clearInterval(keepAliveInterval);
        }
        // If we're a client and the WebSocket closes, it likely means the host disconnected
        if (!this.isHost) {
          this.onConnectionStateChange?.("disconnected");
          this.onDisconnectionReason?.(
            "Connection lost - host may have disconnected"
          );
        }
      };
    });
  }

  private async createSession(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.ws) {
        reject(new Error("WebSocket not connected"));
        return;
      }

      if (this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error("WebSocket not ready"));
        return;
      }

      this.sendSignalingMessage({
        type: "create_session",
        sessionId: this.sessionId,
      });

      const handleMessage = (event: MessageEvent) => {
        const message = JSON.parse(event.data);

        if (
          message.type === "session_created" &&
          message.sessionId === this.sessionId
        ) {
          this.ws?.removeEventListener("message", handleMessage);
          resolve();
        } else if (message.type === "session_error") {
          console.error("Session creation failed:", message.error);
          this.ws?.removeEventListener("message", handleMessage);
          reject(new Error(message.error));
        }
      };

      this.ws.addEventListener("message", handleMessage);

      // Add timeout to prevent hanging
      setTimeout(() => {
        this.ws?.removeEventListener("message", handleMessage);
        reject(new Error("Session creation timeout"));
      }, 10000); // 10 second timeout
    });
  }

  private async joinSession(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.ws) {
        reject(new Error("WebSocket not connected"));
        return;
      }

      if (this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error("WebSocket not ready"));
        return;
      }

      this.sendSignalingMessage({
        type: "join_session",
        sessionId: this.sessionId,
        clientId: this.clientId,
      });

      const handleMessage = (event: MessageEvent) => {
        const message = JSON.parse(event.data);

        if (
          message.type === "session_joined" &&
          message.sessionId === this.sessionId
        ) {
          this.ws?.removeEventListener("message", handleMessage);
          resolve();
        } else if (message.type === "session_error") {
          console.error("Session join failed:", message.error);
          this.ws?.removeEventListener("message", handleMessage);
          reject(new Error(message.error));
        }
      };

      this.ws.addEventListener("message", handleMessage);

      // Add timeout to prevent hanging
      setTimeout(() => {
        this.ws?.removeEventListener("message", handleMessage);
        reject(new Error("Session join timeout"));
      }, 10000); // 10 second timeout
    });
  }

  private async addStreamToPeerConnection(stream: MediaStream): Promise<void> {
    if (!this.peerConnection) {
      throw new Error("Peer connection not initialized");
    }

    stream.getTracks().forEach((track) => {
      this.peerConnection?.addTrack(track, stream);
    });
  }

  private handleSignalingMessage(message: SignalingMessage) {
    switch (message.type) {
      case "client_joined":
        // Host should request permission when client joins
        if (this.isHost) {
          this.onPermissionRequest?.(
            message.clientId || "",
            message.sessionId || ""
          );
        }
        break;

      case "client_left":
        break;

      case "session_error":
        console.error("Session error:", message.data);
        // Don't throw here, let the calling code handle the error
        break;

      case "session_created":
        break;

      case "offer":
        this.handleOffer(message.data || message.offer);
        break;

      case "answer":
        this.handleAnswer(message.data || message.answer);
        break;

      case "ice_candidate":
        this.handleIceCandidate(message.data || message.candidate);
        break;

      case "host_disconnected":
        this.onConnectionStateChange?.("disconnected");
        this.onDisconnectionReason?.("Host disconnected from the session");
        break;

      case "session_terminated":
        this.onConnectionStateChange?.("disconnected");
        this.onDisconnectionReason?.(message.reason || "Session terminated");
        // Clean up the connection immediately
        this.disconnect();
        break;

      case "client_disconnected":
        break;

      case "mouse_move":
      case "mouse_click":
      case "mouse_down":
      case "mouse_up":
        if (this.isHost && message.mouseData) {
          this.onMouseEvent?.(message.mouseData, message.type);
        }
        break;

      case "screen_resolution":
        if (!this.isHost && message.resolution) {
          this.onScreenResolution?.(message.resolution);
        }
        break;

      case "key_down":
      case "key_up":
        if (this.isHost && message.keyboardData) {
          this.onKeyboardEvent?.(message.keyboardData, message.type);
        }
        break;

      case "permission_request":
        if (this.isHost) {
          this.onPermissionRequest?.(
            message.clientId || "",
            message.sessionId || ""
          );
        }
        break;

      case "permission_response":
        if (!this.isHost) {
          this.onPermissionResponse?.(message.granted || false);
          if (message.granted) {
            // Permission granted, expect to receive stream soon
          } else {
            // Permission denied, disconnect
            this.onConnectionStateChange?.("disconnected");
          }
        }
        break;

      default:
        console.warn("Unknown signaling message type:", message.type);
    }
  }

  private async handleOffer(offer: RTCSessionDescriptionInit) {
    if (!this.peerConnection || !offer) return;

    try {
      // Validate offer
      if (!offer.type || !offer.sdp) {
        console.error("Invalid offer received:", offer);
        return;
      }

      await this.peerConnection.setRemoteDescription(
        new RTCSessionDescription(offer)
      );
      const answer = await this.peerConnection.createAnswer();
      await this.peerConnection.setLocalDescription(answer);

      this.sendSignalingMessage({
        type: "answer",
        sessionId: this.sessionId,
        clientId: this.clientId,
        data: answer,
      });
    } catch (error) {
      console.error("Error handling offer:", error);
    }
  }

  private async handleAnswer(answer: RTCSessionDescriptionInit) {
    if (!this.peerConnection || !answer) return;

    try {
      // Validate answer
      if (!answer.type || !answer.sdp) {
        console.error("Invalid answer received:", answer);
        return;
      }

      await this.peerConnection.setRemoteDescription(
        new RTCSessionDescription(answer)
      );
    } catch (error) {
      console.error("Error handling answer:", error);
    }
  }

  private async handleIceCandidate(candidate: RTCIceCandidateInit) {
    if (!this.peerConnection || !candidate) return;

    try {
      // Validate ICE candidate
      if (
        !candidate.candidate ||
        (!candidate.sdpMid && candidate.sdpMLineIndex === null)
      ) {
        console.error("Invalid ICE candidate received:", candidate);
        return;
      }

      await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (error) {
      console.error("Error handling ICE candidate:", error);
    }
  }

  private sendSignalingMessage(message: SignalingMessage) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      console.error("WebSocket not connected");
    }
  }

  public setOnStreamReceived(callback: (stream: MediaStream) => void) {
    this.onStreamReceived = callback;
  }

  public setOnConnectionStateChange(callback: (state: string) => void) {
    this.onConnectionStateChange = callback;
  }

  public setOnMouseEvent(
    callback: (
      mouseData: { x: number; y: number; button?: string },
      type: string
    ) => void
  ) {
    this.onMouseEvent = callback;
  }

  public setOnScreenResolution(
    callback: (resolution: { width: number; height: number }) => void
  ) {
    this.onScreenResolution = callback;
  }

  public setOnKeyboardEvent(
    callback: (
      keyboardData: {
        key: string;
        code: string;
        ctrlKey: boolean;
        shiftKey: boolean;
        altKey: boolean;
        metaKey: boolean;
      },
      type: string
    ) => void
  ) {
    this.onKeyboardEvent = callback;
  }

  public setOnPermissionRequest(
    callback: (clientId: string, sessionId: string) => void
  ) {
    this.onPermissionRequest = callback;
  }

  public setOnPermissionResponse(callback: (granted: boolean) => void) {
    this.onPermissionResponse = callback;
  }

  public setOnDisconnectionReason(callback: (reason: string) => void) {
    this.onDisconnectionReason = callback;
  }

  public sendKeyboardEvent(
    type: "key_down" | "key_up",
    key: string,
    code: string,
    ctrlKey: boolean,
    shiftKey: boolean,
    altKey: boolean,
    metaKey: boolean
  ) {
    if (!this.isHost && this.ws?.readyState === WebSocket.OPEN) {
      this.sendSignalingMessage({
        type,
        sessionId: this.sessionId,
        clientId: this.clientId,
        keyboardData: { key, code, ctrlKey, shiftKey, altKey, metaKey },
      });
    }
  }

  public sendMouseEvent(
    type: "mouse_move" | "mouse_click" | "mouse_down" | "mouse_up",
    x: number,
    y: number,
    button?: "left" | "right" | "middle"
  ) {
    if (!this.isHost && this.ws?.readyState === WebSocket.OPEN) {
      this.sendSignalingMessage({
        type,
        sessionId: this.sessionId,
        clientId: this.clientId,
        mouseData: { x, y, button },
      });
    }
  }

  public sendScreenResolution(width: number, height: number) {
    if (this.isHost) {
      this.sendSignalingMessage({
        type: "screen_resolution",
        sessionId: this.sessionId,
        clientId: this.clientId,
        resolution: { width, height },
      });
    }
  }

  public async createOffer(): Promise<RTCSessionDescriptionInit> {
    if (!this.peerConnection) {
      throw new Error("Peer connection not initialized");
    }

    // For role reversal scenarios, we might need to restart ICE gathering
    const offerOptions: RTCOfferOptions = {
      iceRestart: true, // This helps with role reversal scenarios
    };

    const offer = await this.peerConnection.createOffer(offerOptions);
    await this.peerConnection.setLocalDescription(offer);

    this.sendSignalingMessage({
      type: "offer",
      sessionId: this.sessionId,
      clientId: this.clientId,
      data: offer,
    });

    return offer;
  }

  private async createAndSendOffer(clientId: string): Promise<void> {
    if (!this.peerConnection) {
      console.error("Peer connection not initialized");
      return;
    }

    try {
      // For role reversal scenarios, we might need to restart ICE gathering
      const offerOptions: RTCOfferOptions = {
        iceRestart: true, // This helps with role reversal scenarios
      };

      const offer = await this.peerConnection.createOffer(offerOptions);
      await this.peerConnection.setLocalDescription(offer);

      this.sendSignalingMessage({
        type: "offer",
        sessionId: this.sessionId,
        clientId: clientId,
        data: offer,
      });
    } catch (error) {
      console.error("Error creating offer:", error);
    }
  }

  public sendPermissionResponse(
    clientId: string,
    sessionId: string,
    granted: boolean
  ) {
    if (this.isHost) {
      this.sendSignalingMessage({
        type: "permission_response",
        sessionId: sessionId,
        clientId: clientId,
        granted: granted,
      });

      // If permission granted, create and send offer
      if (granted) {
        this.createAndSendOffer(clientId);
      }
    }
  }

  public async addScreenStream(stream: MediaStream): Promise<void> {
    if (!this.peerConnection) {
      throw new Error("Peer connection not initialized");
    }

    // Remove existing tracks first
    const senders = this.peerConnection.getSenders();
    for (const sender of senders) {
      if (sender.track) {
        this.peerConnection.removeTrack(sender);
      }
    }

    // Add new stream tracks
    stream.getTracks().forEach((track) => {
      this.peerConnection?.addTrack(track, stream);
    });
  }

  public disconnect() {
    // Send leave message before closing connections
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.sendSignalingMessage({
        type: "leave_session",
        sessionId: this.sessionId,
        clientId: this.clientId,
      });
    }

    // Close WebSocket connection
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    // Close and cleanup peer connection
    if (this.peerConnection) {
      // Remove all tracks first to avoid memory leaks
      const senders = this.peerConnection.getSenders();
      senders.forEach((sender) => {
        if (sender.track) {
          this.peerConnection?.removeTrack(sender);
        }
      });

      // Close the connection
      this.peerConnection.close();
      this.peerConnection = null;
    }

    // Reset all internal state
    this.sessionId = "";
    this.clientId = "";
    this.isHost = false;

    // Clear all callback references to prevent memory leaks
    this.onStreamReceived = undefined;
    this.onConnectionStateChange = undefined;
    this.onMouseEvent = undefined;
    this.onKeyboardEvent = undefined;
    this.onScreenResolution = undefined;
    this.onPermissionRequest = undefined;
    this.onPermissionResponse = undefined;
    this.onDisconnectionReason = undefined;
  }
}
