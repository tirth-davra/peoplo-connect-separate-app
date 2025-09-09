// WebSocket utility for real-time session status updates
export interface SessionStatusUpdate {
  sessionId: string;
  status: 'online' | 'offline';
  timestamp: string;
}

export interface StatusSubscriptionCallback {
  (update: SessionStatusUpdate): void;
}

export class StatusWebSocketManager {
  private ws: WebSocket | null = null;
  private callbacks: Set<StatusSubscriptionCallback> = new Set();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 3000; // 3 seconds
  private isConnecting = false;

  constructor() {
    this.connect();
  }

  private connect(): void {
    if (this.isConnecting || (this.ws && this.ws.readyState === WebSocket.OPEN)) {
      return;
    }

    this.isConnecting = true;

    try {
      // Use local WebSocket server for Electron app, fallback to environment variable
      const wsUrl = process.env.NEXT_PUBLIC_WEBSOCKET_URL || 'ws://localhost:8080';
      this.ws = new WebSocket(wsUrl);

      // Keep-alive mechanism for status WebSocket
      let keepAliveInterval: NodeJS.Timeout | null = null;

      this.ws.onopen = () => {
        console.log('📡 Status WebSocket connected');
        this.isConnecting = false;
        this.reconnectAttempts = 0;
        
        // Start keep-alive for status WebSocket (send ping every 30 seconds)
        keepAliveInterval = setInterval(() => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            try {
              this.ws.send(JSON.stringify({ 
                type: "ping", 
                timestamp: Date.now() 
              }));
              console.log("💓 Sent status WebSocket ping");
            } catch (error) {
              console.error("❌ Error sending status WebSocket ping:", error);
            }
          }
        }, 30000); // 30 seconds
        
        // Subscribe to status updates
        this.ws?.send(JSON.stringify({
          type: 'subscribe_status_updates'
        }));
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          
          // Handle pong responses from server
          if (message.type === "pong") {
            console.log("💓 Received pong from status WebSocket server");
            return;
          }
          
          this.handleMessage(message);
        } catch (error) {
          console.error('Error parsing status WebSocket message:', error);
        }
      };

      this.ws.onclose = (event) => {
        console.log('📡 Status WebSocket disconnected');
        this.isConnecting = false;
        this.ws = null;
        
        // Clean up keep-alive interval
        if (keepAliveInterval) {
          clearInterval(keepAliveInterval);
        }
        
        // Attempt to reconnect if not a manual close
        if (event.code !== 1000 && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++;
          console.log(`📡 Attempting to reconnect status WebSocket (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
          
          setTimeout(() => {
            this.connect();
          }, this.reconnectDelay);
        }
      };

      this.ws.onerror = (error) => {
        console.error('📡 Status WebSocket error:', error);
        this.isConnecting = false;
        
        // Clean up keep-alive interval on error
        if (keepAliveInterval) {
          clearInterval(keepAliveInterval);
        }
      };

    } catch (error) {
      console.error('Failed to create status WebSocket connection:', error);
      this.isConnecting = false;
    }
  }

  private handleMessage(message: any): void {
    switch (message.type) {
      case 'session_status_update':
        const update: SessionStatusUpdate = {
          sessionId: message.sessionId,
          status: message.status,
          timestamp: message.timestamp
        };
        
        // Notify all callbacks
        this.callbacks.forEach(callback => {
          try {
            callback(update);
          } catch (error) {
            console.error('Error in status update callback:', error);
          }
        });
        break;
        
      case 'status_subscription_confirmed':
        console.log('📡 Status subscription confirmed');
        break;
        
      default:
        // Ignore other message types
        break;
    }
  }

  public subscribe(callback: StatusSubscriptionCallback): () => void {
    this.callbacks.add(callback);
    
    // Return unsubscribe function
    return () => {
      this.callbacks.delete(callback);
    };
  }

  public disconnect(): void {
    if (this.ws) {
      this.ws.close(1000); // Normal closure
      this.ws = null;
    }
    this.callbacks.clear();
  }

  public isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

// Singleton instance
let statusWebSocketManager: StatusWebSocketManager | null = null;

export function getStatusWebSocketManager(): StatusWebSocketManager {
  if (!statusWebSocketManager) {
    statusWebSocketManager = new StatusWebSocketManager();
  }
  return statusWebSocketManager;
}

export function cleanupStatusWebSocket(): void {
  if (statusWebSocketManager) {
    statusWebSocketManager.disconnect();
    statusWebSocketManager = null;
  }
}
