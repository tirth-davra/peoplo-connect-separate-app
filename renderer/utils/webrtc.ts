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
  private dataChannel: RTCDataChannel | null = null;
  private sessionId: string = "";
  private clientId: string = "";
  private isHost: boolean = false;
  private useDataChannelForInput: boolean = false; // Flag to control input method
  private mouseMoveQueue: Array<{x: number, y: number}> = [];
  private mouseMoveTimeout: NodeJS.Timeout | null = null;
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

    // Setup DataChannel handler for incoming channels
    this.setupDataChannelHandler();
  }

  // Method to reinitialize the peer connection for role reversal scenarios
  public reinitializePeerConnection() {
    this.setupPeerConnection();
  }

  // Setup DataChannel for input events
  private setupDataChannel() {
    if (!this.peerConnection) {
      console.error("Peer connection not initialized");
      return;
    }

    // Create DataChannel with optimized settings for low latency
    this.dataChannel = this.peerConnection.createDataChannel("inputEvents", {
      ordered: false, // Allow out-of-order delivery for better latency
      maxRetransmits: 0, // Don't retransmit for real-time input
    });

    // Set binary type to arraybuffer for better performance
    this.dataChannel.binaryType = "arraybuffer";
    
    // Optimize for high-frequency mouse events
    this.dataChannel.bufferedAmountLowThreshold = 0;

    this.dataChannel.onopen = () => {
      console.log("✅ DataChannel opened for input events");
      this.useDataChannelForInput = true;
    };

    this.dataChannel.onclose = () => {
      console.log("❌ DataChannel closed for input events");
      this.useDataChannelForInput = false;
      this.dataChannel = null;
    };

    this.dataChannel.onerror = (error) => {
      console.error("❌ DataChannel error:", error);
      this.useDataChannelForInput = false;
    };

    this.dataChannel.onmessage = (event) => {
      this.handleDataChannelMessage(event.data);
    };
  }

  // Handle incoming DataChannel messages
  private handleDataChannelMessage(data: string) {
    try {
      const message = JSON.parse(data);
      
      // Handle input events from DataChannel
      switch (message.type) {
        case "mouse_move":
        case "mouse_click":
        case "mouse_down":
        case "mouse_up":
          if (this.isHost && message.mouseData) {
            this.onMouseEvent?.(message.mouseData, message.type);
          }
          break;

        case "mouse_move_batch":
          if (this.isHost && message.mouseData && Array.isArray(message.mouseData)) {
            // Process each mouse movement in the batch
            message.mouseData.forEach((mouseData: {x: number, y: number}) => {
              this.onMouseEvent?.(mouseData, "mouse_move");
            });
          }
          break;

        case "key_down":
        case "key_up":
          if (this.isHost && message.keyboardData) {
            this.onKeyboardEvent?.(message.keyboardData, message.type);
          }
          break;

        case "screen_resolution":
          if (!this.isHost && message.resolution) {
            this.onScreenResolution?.(message.resolution);
          }
          break;

        default:
          console.warn("Unknown DataChannel message type:", message.type);
      }
    } catch (error) {
      console.error("Error parsing DataChannel message:", error);
    }
  }

  // Send message via DataChannel
  private sendDataChannelMessage(message: any) {
    if (this.dataChannel && this.dataChannel.readyState === "open") {
      try {
        // Use JSON.stringify with minimal spacing for smaller payload
        const jsonString = JSON.stringify(message);
        this.dataChannel.send(jsonString);
        return true;
      } catch (error) {
        console.error("Error sending DataChannel message:", error);
        return false;
      }
    }
    return false;
  }

  // Send batched mouse movements for better performance
  private sendBatchedMouseMove() {
    if (this.mouseMoveQueue.length === 0) return;

    const message = {
      type: "mouse_move_batch",
      sessionId: this.sessionId,
      clientId: this.clientId,
      mouseData: this.mouseMoveQueue,
    };

    const dataChannelSent = this.sendDataChannelMessage(message);
    
    if (!dataChannelSent && this.ws?.readyState === WebSocket.OPEN) {
      // Send individual mouse moves via WebSocket as fallback
      this.mouseMoveQueue.forEach(({x, y}) => {
        this.sendSignalingMessage({
          type: "mouse_move",
          sessionId: this.sessionId,
          clientId: this.clientId,
          mouseData: { x, y },
        });
      });
    }

    this.mouseMoveQueue = [];
    this.mouseMoveTimeout = null;
  }

  // Handle incoming DataChannel (when peer creates it)
  private setupDataChannelHandler() {
    if (!this.peerConnection) {
      console.error("Peer connection not initialized");
      return;
    }

    this.peerConnection.ondatachannel = (event) => {
      const channel = event.channel;
      console.log("📡 Received DataChannel:", channel.label);

      if (channel.label === "inputEvents") {
        this.dataChannel = channel;

        channel.onopen = () => {
          console.log("✅ DataChannel opened for input events");
          this.useDataChannelForInput = true;
        };

        channel.onclose = () => {
          console.log("❌ DataChannel closed for input events");
          this.useDataChannelForInput = false;
          this.dataChannel = null;
        };

        channel.onerror = (error) => {
          console.error("❌ DataChannel error:", error);
          this.useDataChannelForInput = false;
        };

        channel.onmessage = (event) => {
          this.handleDataChannelMessage(event.data);
        };
      }
    };
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

    // Setup DataChannel for input events (host creates the channel)
    this.setupDataChannel();

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

  // Method to enable/disable DataChannel usage for input events
  public setUseDataChannelForInput(useDataChannel: boolean) {
    this.useDataChannelForInput = useDataChannel;
    console.log(`🔄 DataChannel for input events: ${useDataChannel ? 'enabled' : 'disabled'}`);
  }

  // Method to check if DataChannel is available and ready
  public isDataChannelReady(): boolean {
    return this.dataChannel !== null && this.dataChannel.readyState === "open";
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
    if (!this.isHost) {
      const message = {
        type,
        sessionId: this.sessionId,
        clientId: this.clientId,
        keyboardData: { key, code, ctrlKey, shiftKey, altKey, metaKey },
      };

      // Try DataChannel first (if available and open)
      const dataChannelSent = this.sendDataChannelMessage(message);
      
      // Only send via WebSocket if DataChannel is not available
      if (!dataChannelSent && this.ws?.readyState === WebSocket.OPEN) {
        this.sendSignalingMessage(message);
        console.log(`🌐 Sent ${type} via WebSocket (DataChannel not available)`);
      } else if (dataChannelSent) {
        console.log(`📡 Sent ${type} via DataChannel`);
      }
    }
  }

  public sendMouseEvent(
    type: "mouse_move" | "mouse_click" | "mouse_down" | "mouse_up",
    x: number,
    y: number,
    button?: "left" | "right" | "middle"
  ) {
    if (!this.isHost) {
      // Handle mouse movements with batching for better performance
      if (type === "mouse_move") {
        this.mouseMoveQueue.push({ x, y });
        
        // Clear existing timeout
        if (this.mouseMoveTimeout) {
          clearTimeout(this.mouseMoveTimeout);
        }
        
        // Send immediately for very smooth movement
        this.mouseMoveTimeout = setTimeout(() => {
          this.sendBatchedMouseMove();
        }, 0); // Send immediately on next tick
        
        return;
      }

      // Handle other mouse events (clicks, etc.) immediately
      const message = {
        type,
        sessionId: this.sessionId,
        clientId: this.clientId,
        mouseData: { x, y, button },
      };

      // Try DataChannel first (if available and open)
      const dataChannelSent = this.sendDataChannelMessage(message);
      
      // Only send via WebSocket if DataChannel is not available
      if (!dataChannelSent && this.ws?.readyState === WebSocket.OPEN) {
        this.sendSignalingMessage(message);
        console.log(`🌐 Sent ${type} via WebSocket (DataChannel not available)`);
      }
    }
  }

  public sendScreenResolution(width: number, height: number) {
    if (this.isHost) {
      const message = {
        type: "screen_resolution",
        sessionId: this.sessionId,
        clientId: this.clientId,
        resolution: { width, height },
      };

      // Try DataChannel first (if available and open)
      const dataChannelSent = this.sendDataChannelMessage(message);
      
      // Only send via WebSocket if DataChannel is not available
      if (!dataChannelSent) {
        this.sendSignalingMessage(message);
        console.log("🌐 Sent screen_resolution via WebSocket (DataChannel not available)");
      } else {
        console.log("📡 Sent screen_resolution via DataChannel");
      }
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

    // Clear mouse move timeout
    if (this.mouseMoveTimeout) {
      clearTimeout(this.mouseMoveTimeout);
      this.mouseMoveTimeout = null;
    }

    // Close DataChannel
    if (this.dataChannel) {
      this.dataChannel.close();
      this.dataChannel = null;
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
    this.useDataChannelForInput = false;
    this.mouseMoveQueue = [];

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
