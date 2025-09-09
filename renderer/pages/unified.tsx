import React, { useState, useEffect, useRef, useCallback } from "react";
import Head from "next/head";
import { WebRTCManager } from "../utils/webrtc";
import { ProtectedRoute } from "../components/ProtectedRoute";
import { LogoutButton } from "../components/LogoutButton";
import { useAuth } from "../contexts/AuthContext";
import { storage } from "../utils/storage";
import {
  addRecentSession,
  getRecentSessions,
  removeRecentSession,
  checkBatchSessionStatus,
  testSupabaseConnection,
} from "../api/recentSessionsAPI";
import {
  getStatusWebSocketManager,
  cleanupStatusWebSocket,
  SessionStatusUpdate,
} from "../utils/statusWebSocket";

// Generate consistent color class for session cards
const getSessionCardColor = (sessionId: number): string => {
  const colors = [
    "session-card-brand-1",
    "session-card-brand-2",
    "session-card-brand-3",
    "session-card-brand-4",
  ];

  // Use a simple hash to distribute across 4 brand colors
  const str = sessionId.toString();
  let hash = 5381; // DJB2 hash algorithm

  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) + hash + str.charCodeAt(i);
  }

  // Ensure positive number and distribute across 4 brand colors
  const colorIndex = Math.abs(hash * 9301 + 49297) % colors.length;

  return colors[colorIndex];
};

// Convert browser key names to robotjs format
const convertKeyToRobotjs = (key: string, code: string): string => {
  const keyMap: { [key: string]: string } = {
    " ": "space",
    Enter: "enter",
    Tab: "tab",
    Escape: "escape",
    Backspace: "backspace",
    Delete: "delete",
    ArrowUp: "up",
    ArrowDown: "down",
    ArrowLeft: "left",
    ArrowRight: "right",
    Home: "home",
    End: "end",
    PageUp: "pageup",
    PageDown: "pagedown",
    Insert: "insert",
    CapsLock: "capslock",
    NumLock: "numlock",
    ScrollLock: "scrolllock",
    PrintScreen: "printscreen",
    Pause: "pause",
    F1: "f1",
    F2: "f2",
    F3: "f3",
    F4: "f4",
    F5: "f5",
    F6: "f6",
    F7: "f7",
    F8: "f8",
    F9: "f9",
    F10: "f10",
    F11: "f11",
    F12: "f12",
  };

  return keyMap[key] || key.toLowerCase();
};

export default function UnifiedPage() {
  return (
    <ProtectedRoute>
      <UnifiedPageContent />
    </ProtectedRoute>
  );
}

function UnifiedPageContent() {
  const { sessionCode, logout } = useAuth();

  // Use stored session code instead of auto-generating
  const [mySessionId, setMySessionId] = useState<string>("");

  // Connection state
  const [remoteSessionId, setRemoteSessionId] = useState("");
  const [connectionStatus, setConnectionStatus] = useState<
    "disconnected" | "connecting" | "connected" | "waiting_for_permission"
  >("disconnected");
  const [errorMessage, setErrorMessage] = useState("");
  const [disconnectionReason, setDisconnectionReason] = useState<string>("");
  const [isSharing, setIsSharing] = useState(false);
  const [connectedClients, setConnectedClients] = useState(0);
  const [hostResolution, setHostResolution] = useState<{
    width: number;
    height: number;
  } | null>(null);

  // Permission system
  const [showPermissionDialog, setShowPermissionDialog] = useState(false);
  const [pendingConnectionRequest, setPendingConnectionRequest] = useState<{
    clientId: string;
    sessionId: string;
  } | null>(null);

  // Control settings - always enabled
  const mouseControlEnabled = true;
  const keyboardControlEnabled = true;
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [debugMode, setDebugMode] = useState(false);

  // Recent sessions - loaded from API
  const [recentSessions, setRecentSessions] = useState<
    Array<{
      id: string; // UUID
      session_id: number; // BIGINT - 10-digit session code
      first_name?: string;
      last_name?: string;
      isActive?: boolean;
      status?: "online" | "offline";
    }>
  >([]);
  const [loadingRecentSessions, setLoadingRecentSessions] = useState(false);

  // Selected session for actions
  const [selectedSession, setSelectedSession] = useState<string | null>(null);

  // Session error popup state
  const [showSessionErrorPopup, setShowSessionErrorPopup] = useState(false);
  const [sessionErrorDetails, setSessionErrorDetails] = useState<{
    title: string;
    message: string;
    sessionId?: string;
  } | null>(null);

  // Load recent sessions on component mount
  useEffect(() => {
    // Test Supabase connection first
    testSupabaseConnection().then((result) => {
      if (result.success) {
        console.log("✅ Supabase connection test passed:", result.message);
        loadRecentSessions();
      } else {
        console.error("❌ Supabase connection test failed:", result.error);
        setErrorMessage(`Database connection issue: ${result.error}`);
      }
    });
  }, []);

  // Cleanup effect - runs when component unmounts or sessionCode changes
  useEffect(() => {
    return () => {
      // Cleanup WebRTC connections when component unmounts
      if (webrtcManagerRef.current) {
        webrtcManagerRef.current.disconnect();
      }

      // Cleanup status WebSocket
      cleanupStatusWebSocket();
    };
  }, [sessionCode]); // Re-run when sessionCode changes (login/logout)

  // Setup real-time status updates via WebSocket
  useEffect(() => {
    const statusWS = getStatusWebSocketManager();

    const unsubscribe = statusWS.subscribe((update: SessionStatusUpdate) => {

      // Update the status of the specific session in real-time
      setRecentSessions((prevSessions) =>
        prevSessions.map((session) => {
          if (session.session_id.toString() === update.sessionId) {
            return {
              ...session,
              isActive: update.status === "online",
              status: update.status,
            };
          }
          return session;
        })
      );
    });

    // Fallback: If WebSocket is not connected after 5 seconds, use periodic API calls
    const fallbackTimeout = setTimeout(() => {
      if (!statusWS.isConnected()) {

        const fallbackInterval = setInterval(async () => {
          if (recentSessions.length > 0 && !loadingRecentSessions) {
            try {
              const sessionIds = recentSessions.map((session) =>
                session.session_id.toString()
              );
              const statusResponse = await checkBatchSessionStatus(sessionIds);

              if (statusResponse.success) {
                setRecentSessions((prevSessions) =>
                  prevSessions.map((session) => {
                    const statusInfo = statusResponse.data.find(
                      (status) =>
                        status.sessionId === session.session_id.toString()
                    );
                    return {
                      ...session,
                      isActive: statusInfo?.isActive || false,
                      status: statusInfo?.status || ("offline" as const),
                    };
                  })
                );
              }
            } catch (error) {
              console.error("Failed to refresh session statuses:", error);
            }
          }
        }, 60000); // Check every 60 seconds as fallback

        // Store the interval reference for cleanup
        return () => {
          clearInterval(fallbackInterval);
          unsubscribe();
        };
      }
    }, 5000);

    // Cleanup on unmount
    return () => {
      clearTimeout(fallbackTimeout);
      unsubscribe();
    };
  }, [recentSessions.length, loadingRecentSessions]);

  // Cleanup WebSocket on component unmount
  useEffect(() => {
    return () => {
      // Only cleanup if this is the last component using it
      // In a real app, you might want to use a ref counter
      cleanupStatusWebSocket();
    };
  }, []);

  // Monitor fullscreen state changes and restore video stream when needed
  useEffect(() => {
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement && isFullscreen) {
        // Fullscreen was exited, restore the video stream
        setTimeout(() => {
          if (currentStreamRef.current && videoRef.current) {
            videoRef.current.srcObject = currentStreamRef.current;
            videoRef.current
              .play()
              .catch((e) =>
                console.error("Video play failed during restore:", e)
              );
          }
        }, 100);
      }
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, [isFullscreen]);

  // Monitor connection stability and handle disconnections
  useEffect(() => {
    let connectionCheckInterval: NodeJS.Timeout;

    if (connectionStatus === "connected") {
      connectionCheckInterval = setInterval(() => {
        // Check if WebRTC connection is still healthy
        if (webrtcManagerRef.current) {
          const peerConnection = (webrtcManagerRef.current as any)
            .peerConnection;
          if (peerConnection && peerConnection.connectionState === "failed") {
            setDisconnectionReason(
              "Connection lost - attempting to reconnect..."
            );
            // Trigger reconnection logic
            disconnect();
            setTimeout(() => {
              if (remoteSessionId) {
                connectToRemote(remoteSessionId);
              }
            }, 1000);
          }
        }
      }, 5000); // Check every 5 seconds
    }

    return () => {
      if (connectionCheckInterval) {
        clearInterval(connectionCheckInterval);
      }
    };
  }, [connectionStatus, remoteSessionId]);

  const loadRecentSessions = async () => {
    try {
      setLoadingRecentSessions(true);
      const response = await getRecentSessions();
      if (response.success && response.data.length > 0) {
        // Get session IDs to check their status (only once when app loads)
        const sessionIds = response.data.map((session) =>
          session.session_id.toString()
        );

        try {
          // Check the status of all sessions in a single batch call
          const statusResponse = await checkBatchSessionStatus(sessionIds);
          if (statusResponse.success) {
            // Merge session data with status information
            const sessionsWithStatus = response.data.map((session) => {
              const statusInfo = statusResponse.data.find(
                (status) => status.sessionId === session.session_id.toString()
              );
              return {
                ...session,
                isActive: statusInfo?.isActive || false,
                status: statusInfo?.status || ("offline" as const),
              };
            });
            setRecentSessions(sessionsWithStatus);
          } else {
            // If status check fails, still show sessions but mark as offline
            const sessionsWithStatus = response.data.map((session) => ({
              ...session,
              isActive: false,
              status: "offline" as const,
            }));
            setRecentSessions(sessionsWithStatus);
          }
        } catch (statusError) {
          console.error("Failed to check session statuses:", statusError);
          // If status check fails, still show sessions but mark as offline
          const sessionsWithStatus = response.data.map((session) => ({
            ...session,
            isActive: false,
            status: "offline" as const,
          }));
          setRecentSessions(sessionsWithStatus);
        }
      } else {
        setRecentSessions([]);
      }
    } catch (error) {
      console.error("Failed to load recent sessions:", error);
      setRecentSessions([]);
    } finally {
      setLoadingRecentSessions(false);
    }
  };

  const addToRecentSessions = async (sessionId: string) => {
    try {
      console.log("🔄 Attempting to add recent session:", sessionId);
      
      // Validate session ID before attempting to add
      if (!sessionId || !/^\d{10}$/.test(sessionId)) {
        console.error("❌ Invalid session ID for recent sessions:", sessionId);
        return;
      }

      const response = await addRecentSession(sessionId);
      if (response.success) {
        console.log("✅ Recent session added successfully:", response.message);
        // Reload recent sessions to get the updated list
        await loadRecentSessions();
      } else {
        console.error("❌ Failed to add recent session:", response.message);
      }
    } catch (error) {
      console.error("❌ Failed to add recent session:", error);
      // Show user-friendly error message
      setErrorMessage(`Failed to save session to recent: ${error.message}`);
      setTimeout(() => setErrorMessage(""), 5000);
    }
  };

  // Refs
  const webrtcManagerRef = useRef<WebRTCManager | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const fullscreenVideoRef = useRef<HTMLVideoElement>(null);
  const lastMouseMoveRef = useRef<number>(0);
  const cachedResolutionRef = useRef<{ width: number; height: number } | null>(
    null
  );
  const currentStreamRef = useRef<MediaStream | null>(null);
  const isRestartingAsHostRef = useRef<boolean>(false); // Prevent multiple restart attempts

  // Use stored session code on component mount
  useEffect(() => {
    if (sessionCode) {
      setMySessionId(sessionCode.toString());
      // Auto-start hosting session with stored session code
      startHostSession(sessionCode.toString());
    }
  }, [sessionCode]);

  // Optimized keyboard event handlers with useCallback
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "Escape" && isFullscreen) {
        exitFullscreen();
        return;
      }

      // Additional escape handling for blank screen situations
      if (
        event.key === "Escape" &&
        connectionStatus === "disconnected" &&
        isFullscreen
      ) {
        exitFullscreen();
        return;
      }

      if (
        keyboardControlEnabled &&
        connectionStatus === "connected" &&
        webrtcManagerRef.current
      ) {
        // Prevent default for most keys except function keys and system keys
        if (event.key !== "F12" && event.key !== "F5" && event.key !== "F11") {
          event.preventDefault();
        }

        // Add a small delay to prevent overwhelming the WebRTC connection
        setTimeout(() => {
          if (webrtcManagerRef.current && connectionStatus === "connected") {
            webrtcManagerRef.current.sendKeyboardEvent(
              "key_down",
              event.key,
              event.code,
              event.ctrlKey,
              event.shiftKey,
              event.altKey,
              event.metaKey
            );
          }
        }, 1);
      }
    },
    [isFullscreen, keyboardControlEnabled, connectionStatus]
  );

  const handleKeyUp = useCallback(
    (event: KeyboardEvent) => {
      if (
        keyboardControlEnabled &&
        connectionStatus === "connected" &&
        webrtcManagerRef.current
      ) {
        // Prevent default for most keys except function keys and system keys
        if (event.key !== "F12" && event.key !== "F5" && event.key !== "F11") {
          event.preventDefault();
        }

        // Add a small delay to prevent overwhelming the WebRTC connection
        setTimeout(() => {
          if (webrtcManagerRef.current && connectionStatus === "connected") {
            webrtcManagerRef.current.sendKeyboardEvent(
              "key_up",
              event.key,
              event.code,
              event.ctrlKey,
              event.shiftKey,
              event.altKey,
              event.metaKey
            );
          }
        }, 1);
      }
    },
    [keyboardControlEnabled, connectionStatus]
  );

  const handleFullscreenChange = useCallback(() => {
    if (!document.fullscreenElement && isFullscreen) {
      setIsFullscreen(false);
    }
  }, [isFullscreen]);

  // Keyboard event listeners
  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("keyup", handleKeyUp);
    document.addEventListener("fullscreenchange", handleFullscreenChange);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("keyup", handleKeyUp);
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, [handleKeyDown, handleKeyUp, handleFullscreenChange]);

  // Close action menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        selectedSession &&
        !(event.target as Element).closest(".recent-session-card")
      ) {
        setSelectedSession(null);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [selectedSession]);

  const startHostSession = useCallback(async (sessionId: string) => {
    try {
      // Ensure any existing WebRTC manager is properly cleaned up
      if (webrtcManagerRef.current) {
        webrtcManagerRef.current.disconnect();
        webrtcManagerRef.current = null;
      }

      // Wait a moment for cleanup to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      webrtcManagerRef.current = new WebRTCManager();

      webrtcManagerRef.current.setOnConnectionStateChange((state) => {
        if (state === "connected") {
          setConnectionStatus("connected");
          setConnectedClients(1);
          setDisconnectionReason(""); // Clear any previous disconnection reason
        } else if (state === "disconnected") {
          setConnectionStatus("disconnected");
          setConnectedClients(0);
        }
      });

      webrtcManagerRef.current.setOnDisconnectionReason((reason) => {
        setDisconnectionReason(reason);
      });

      webrtcManagerRef.current.setOnPermissionRequest((clientId, sessionId) => {
        setPendingConnectionRequest({ clientId, sessionId });
        setShowPermissionDialog(true);
      });

      // Optimized mouse event handler
      webrtcManagerRef.current.setOnMouseEvent(async (mouseData, type) => {
        if (!cachedResolutionRef.current) {
          cachedResolutionRef.current =
            await window.electronAPI.getScreenResolution();
        }

        const resolution = cachedResolutionRef.current;
        const absoluteX = Math.round(mouseData.x * resolution.width);
        const absoluteY = Math.round(mouseData.y * resolution.height);

        try {
          if (type === "mouse_move") {
            await window.electronAPI.mouseMove(absoluteX, absoluteY);
          } else if (type === "mouse_click") {
            await window.electronAPI.mouseClick(
              absoluteX,
              absoluteY,
              mouseData.button || "left"
            );
          }
        } catch (error) {
          console.error("❌ Mouse control error:", error);
        }
      });

      // Optimized keyboard event handler
      webrtcManagerRef.current.setOnKeyboardEvent(
        async (keyboardData, type) => {
          try {
            const robotKey = convertKeyToRobotjs(
              keyboardData.key,
              keyboardData.code
            );
            const modifiers = [];

            if (keyboardData.ctrlKey) modifiers.push("ctrl");
            if (keyboardData.shiftKey) modifiers.push("shift");
            if (keyboardData.altKey) modifiers.push("alt");
            if (keyboardData.metaKey) modifiers.push("cmd");

            if (type === "key_down") {
              await window.electronAPI.keyToggle(
                robotKey,
                true,
                modifiers.length > 0 ? modifiers : undefined
              );
            } else if (type === "key_up") {
              await window.electronAPI.keyToggle(
                robotKey,
                false,
                modifiers.length > 0 ? modifiers : undefined
              );
            }
          } catch (error) {
            console.error("❌ Keyboard control error:", error);
          }
        }
      );

      await webrtcManagerRef.current.startHost(sessionId, null);
    } catch (error) {
      console.error("Error starting host session:", error);
      setErrorMessage("Failed to initialize session");
    }
  }, []);

  const handlePermissionResponse = useCallback(
    async (accepted: boolean) => {
      if (!pendingConnectionRequest || !webrtcManagerRef.current) return;

      setShowPermissionDialog(false);

      if (accepted) {
        try {
          const sources = await window.electronAPI.getDisplayMedia();
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
              mandatory: {
                chromeMediaSource: "desktop",
                chromeMediaSourceId: sources[0].id,
              },
            } as any,
          });

          await webrtcManagerRef.current.addScreenStream(stream);

          const resolution = await window.electronAPI.getScreenResolution();
          cachedResolutionRef.current = resolution;
          webrtcManagerRef.current.sendScreenResolution(
            resolution.width,
            resolution.height
          );

          setIsSharing(true);

          webrtcManagerRef.current.sendPermissionResponse(
            pendingConnectionRequest.clientId,
            pendingConnectionRequest.sessionId,
            true
          );
        } catch (error) {
          console.error("Error starting screen sharing:", error);
          setErrorMessage("Failed to start screen sharing");
          webrtcManagerRef.current.sendPermissionResponse(
            pendingConnectionRequest.clientId,
            pendingConnectionRequest.sessionId,
            false
          );
        }
      } else {
        webrtcManagerRef.current.sendPermissionResponse(
          pendingConnectionRequest.clientId,
          pendingConnectionRequest.sessionId,
          false
        );
      }

      setPendingConnectionRequest(null);
    },
    [pendingConnectionRequest]
  );

  const connectToRemote = useCallback(
    async (sessionId?: string) => {
      const targetSessionId = sessionId || remoteSessionId.trim();

      if (!targetSessionId) {
        setErrorMessage("Please enter a session ID");
        return;
      }

      // Check if there's already an active connection
      if (
        connectionStatus === "connected" ||
        connectionStatus === "connecting" ||
        connectionStatus === "waiting_for_permission"
      ) {
        setErrorMessage(
          "You are already connected. Please disconnect first before starting a new session."
        );
        return;
      }

      try {
        setConnectionStatus("connecting");
        setErrorMessage("");

        // Ensure any existing WebRTC manager is properly cleaned up
        if (webrtcManagerRef.current) {
          webrtcManagerRef.current.disconnect();
          webrtcManagerRef.current = null;
        }

        // Wait a moment for cleanup to complete
        await new Promise((resolve) => setTimeout(resolve, 100));

        webrtcManagerRef.current = new WebRTCManager();

        webrtcManagerRef.current.setOnStreamReceived((stream) => {
          setConnectionStatus("connected");

          // Store the stream reference
          currentStreamRef.current = stream;

          // Optimized stream setting
          const setStreamOnVideo = (videoElement: HTMLVideoElement | null) => {
            if (videoElement) {
              videoElement.srcObject = stream;
              videoElement
                .play()
                .catch((e) => console.error("Video play failed:", e));
            }
          };

          // Set stream on both video elements to ensure they both work
          setStreamOnVideo(videoRef.current);
          setStreamOnVideo(fullscreenVideoRef.current);

          // Additional check to ensure main video element is properly set up
          const ensureMainVideoStream = () => {
            if (videoRef.current && currentStreamRef.current) {
              // Check if the video element actually has the stream
              if (
                !videoRef.current.srcObject ||
                videoRef.current.srcObject !== currentStreamRef.current
              ) {
                videoRef.current.srcObject = currentStreamRef.current;
                videoRef.current
                  .play()
                  .catch((e) =>
                    console.error("Video play failed on ensure check:", e)
                  );
              }
            }
          };

          // Check after a short delay and then again after a longer delay
          setTimeout(ensureMainVideoStream, 100);
          setTimeout(ensureMainVideoStream, 500);

          // Force a small delay and then ensure the main video element has the stream
          setTimeout(() => {
            if (videoRef.current && currentStreamRef.current) {
              videoRef.current.srcObject = currentStreamRef.current;
              videoRef.current
                .play()
                .catch((e) =>
                  console.error("Video play failed on initial setup:", e)
                );
            }
          }, 200);

          // Monitor stream health
          const monitorStreamHealth = () => {
            if (stream && stream.active) {
              // Stream is still active, check again in 2 seconds
              setTimeout(monitorStreamHealth, 2000);
            } else {
              // Stream is no longer active, treat as disconnection
              setConnectionStatus("disconnected");
              setDisconnectionReason(
                "Video stream lost - host may have disconnected"
              );
              if (isFullscreen) {
                exitFullscreen();
              }
            }
          };

          // Start monitoring stream health
          setTimeout(monitorStreamHealth, 2000);
        });

        webrtcManagerRef.current.setOnConnectionStateChange((state) => {
          if (state === "connected") {
            setConnectionStatus("connected");
            setDisconnectionReason(""); // Clear any previous disconnection reason
            // Add to recent sessions when connection is successful
            console.log("🔗 Connection established, adding to recent sessions:", targetSessionId);
            addToRecentSessions(targetSessionId);

            // Ensure video stream is properly set up when connection is established
            setTimeout(() => {
              if (videoRef.current && currentStreamRef.current) {
                videoRef.current.srcObject = currentStreamRef.current;
                videoRef.current
                  .play()
                  .catch((e) =>
                    console.error(
                      "Video play failed on connection state change:",
                      e
                    )
                  );
              }
            }, 300);
          } else if (state === "disconnected" || state === "failed") {
            setConnectionStatus("disconnected");

            // Prevent multiple restart attempts
            if (isRestartingAsHostRef.current) {
              return;
            }
            isRestartingAsHostRef.current = true;

            // Clear remote session ID to prevent reconnection attempts
            setRemoteSessionId("");

            // Automatically exit fullscreen mode when host disconnects
            if (isFullscreen) {
              exitFullscreen();
            }

            // Clear video streams when disconnected
            if (videoRef.current) {
              videoRef.current.srcObject = null;
            }
            if (fullscreenVideoRef.current) {
              fullscreenVideoRef.current.srcObject = null;
            }
            // Clear the stored stream reference
            currentStreamRef.current = null;

            // **KEY FIX**: Client should also restart as host after disconnection
            // This ensures both sides become hosts, enabling role reversal
            setTimeout(async () => {
              // Use mySessionId if available, otherwise use sessionCode from auth
              const sessionIdToUse = mySessionId || sessionCode?.toString();

              if (sessionIdToUse) {
                try {
                  // Clean up current WebRTC manager
                  if (webrtcManagerRef.current) {
                    webrtcManagerRef.current.disconnect();
                    webrtcManagerRef.current = null;
                  }

                  // Wait a bit more for cleanup
                  await new Promise((resolve) => setTimeout(resolve, 200));

                  // Restart as host
                  await startHostSession(sessionIdToUse);

                  // Reset the flag after successful restart
                  isRestartingAsHostRef.current = false;
                } catch (error) {
                  console.error("Client failed to restart as host:", error);
                  // Retry after a longer delay
                  setTimeout(async () => {
                    try {
                      await startHostSession(sessionIdToUse);
                    } catch (retryError) {
                      console.error(
                        "Client failed to restart as host on retry:",
                        retryError
                      );
                    }
                    // Reset the flag after retry attempt
                    isRestartingAsHostRef.current = false;
                  }, 1000);
                }
              } else {
                console.error(
                  "Cannot restart as host - no session ID available"
                );
                isRestartingAsHostRef.current = false;
              }
            }, 500); // Longer delay to ensure cleanup is complete
          }
        });

        webrtcManagerRef.current.setOnDisconnectionReason((reason) => {
          setDisconnectionReason(reason);
        });

        webrtcManagerRef.current.setOnScreenResolution((resolution) => {
          setHostResolution(resolution);
        });

        webrtcManagerRef.current.setOnPermissionResponse((granted) => {
          if (granted) {
            setConnectionStatus("connected");
          } else {
            setConnectionStatus("disconnected");
            setErrorMessage("Connection was denied by the host");
          }
        });

        await webrtcManagerRef.current.startClient(targetSessionId);
        setConnectionStatus("waiting_for_permission");
      } catch (error) {
        console.error("Error connecting to remote:", error);
        setConnectionStatus("disconnected");

        if (
          error instanceof Error &&
          error.message.includes("Session not found")
        ) {
          showSessionError(
            "Session Not Available",
            "This session is not found or may be not in your sessions list. Refresh your session list.",
            targetSessionId
          );
        } else if (
          error instanceof Error &&
          error.message.includes("timeout")
        ) {
          setErrorMessage(
            "Connection timeout. Please check your network connection and try again."
          );
        } else {
          setErrorMessage(
            "Failed to connect. Please check the session ID and try again."
          );
        }
      }
    },
    [remoteSessionId, connectionStatus]
  );

  const disconnect = useCallback(() => {
    if (isFullscreen) {
      exitFullscreen();
    }

    setConnectionStatus("disconnected");
    setErrorMessage("");
    setDisconnectionReason("Disconnected by user"); // Set user-initiated disconnection reason
    setHostResolution(null);
    cachedResolutionRef.current = null;

    // Reset the restart flag to allow manual restart
    isRestartingAsHostRef.current = false;

    // Clear the remote session ID to prevent accidental reconnection attempts
    setRemoteSessionId("");

    // Stop video streams
    const videoElements = [videoRef.current, fullscreenVideoRef.current];
    videoElements.forEach((videoElement) => {
      if (videoElement && videoElement.srcObject) {
        const stream = videoElement.srcObject as MediaStream;
        stream.getTracks().forEach((track) => track.stop());
        videoElement.srcObject = null;
      }
    });

    // Clear the stored stream reference
    currentStreamRef.current = null;

    // Properly disconnect and cleanup WebRTC manager
    if (webrtcManagerRef.current) {
      webrtcManagerRef.current.disconnect();
      webrtcManagerRef.current = null; // Clear the reference to ensure fresh instance
    }

    // Wait a moment for cleanup to complete before restarting as host
    setTimeout(async () => {
      if (mySessionId) {
        try {
          await startHostSession(mySessionId);
        } catch (error) {
          console.error(
            "Failed to restart as host after manual disconnect:",
            error
          );
          // If restarting as host fails, try again after a longer delay
          setTimeout(async () => {
            if (mySessionId) {
              try {
                await startHostSession(mySessionId);
              } catch (retryError) {
                console.error(
                  "Failed to restart as host on retry after manual disconnect:",
                  retryError
                );
              }
            }
          }, 1000);
        }
      }
    }, 200); // Slightly longer delay to ensure complete cleanup

    setIsSharing(false);
    setConnectedClients(0);
  }, [isFullscreen, mySessionId, startHostSession]);

  const handleConnectToRecent = useCallback(
    (sessionId: string) => {
      // Check if there's already an active connection
      if (
        connectionStatus === "connected" ||
        connectionStatus === "connecting" ||
        connectionStatus === "waiting_for_permission"
      ) {
        // Show error message and don't proceed with connection
        setErrorMessage(
          "You are already connected. Please disconnect first before starting a new session."
        );
        setSelectedSession(null); // Close the action menu
        return;
      }

      // Check if the session is active before attempting to connect
      const session = recentSessions.find(
        (s) => s.session_id.toString() === sessionId
      );

      if (!session) {
        showSessionError(
          "Session Not Available",
          "This session is not found or may be not in your sessions list. Refresh your session list.",
          sessionId
        );
        setSelectedSession(null); // Close the action menu
        return;
      }

      if (!session.isActive) {
        showSessionError(
          "Session Not Available",
          "This session is not found or may be not in your sessions list. Refresh your session list.",
          sessionId
        );
        setSelectedSession(null); // Close the action menu
        return;
      }

      // Clear any existing error messages
      setErrorMessage("");
      setRemoteSessionId(sessionId);
      connectToRemote(sessionId);
      setSelectedSession(null); // Close the action menu
    },
    [connectToRemote, connectionStatus, recentSessions]
  );

  const handleRemoveFromRecent = useCallback(
    async (sessionId: string) => {
      try {
        const response = await removeRecentSession(sessionId);
        if (response.success) {
          // Reload recent sessions to get the updated list
          await loadRecentSessions();
        }
      } catch (error) {
        console.error("Failed to remove recent session:", error);
      }
      setSelectedSession(null); // Close the action menu
    },
    [loadRecentSessions]
  );

  const copySessionId = useCallback(() => {
    navigator.clipboard.writeText(mySessionId);
  }, [mySessionId]);

  // Function to show session error popup
  const showSessionError = useCallback(
    (title: string, message: string, sessionId?: string) => {
      setSessionErrorDetails({ title, message, sessionId });
      setShowSessionErrorPopup(true);
    },
    []
  );

  // Function to handle session refresh
  const handleSessionRefresh = useCallback(async () => {
    setShowSessionErrorPopup(false);
    setSessionErrorDetails(null);

    try {
      await loadRecentSessions();
      setErrorMessage(""); // Clear any existing error messages
    } catch (error) {
      console.error("Failed to refresh sessions:", error);
      setErrorMessage("Failed to refresh sessions. Please try again.");
    }
  }, [loadRecentSessions]);

  const enterFullscreen = useCallback(async () => {
    try {
      if (fullscreenVideoRef.current && !isFullscreen) {
        await fullscreenVideoRef.current.requestFullscreen();
        setIsFullscreen(true);
      }
    } catch (error) {
      console.error("Failed to enter fullscreen:", error);
    }
  }, [isFullscreen]);

  const restoreVideoStream = useCallback(() => {
    if (currentStreamRef.current && videoRef.current) {
      videoRef.current.srcObject = currentStreamRef.current;
      videoRef.current
        .play()
        .catch((e) => console.error("Video play failed during restore:", e));
    }
  }, []);

  const exitFullscreen = useCallback(async () => {
    try {
      // Try to exit fullscreen with multiple fallback methods
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      }

      // Force update the fullscreen state
      setIsFullscreen(false);

      // Additional check to ensure we're out of fullscreen
      setTimeout(() => {
        if (document.fullscreenElement) {
          console.warn("Fullscreen exit may have failed, forcing state update");
          setIsFullscreen(false);
        }
      }, 100);
    } catch (error) {
      console.error("Failed to exit fullscreen:", error);
      // Force update state even if exit fails
      setIsFullscreen(false);
    }
  }, []);

  // Additional effect to handle fullscreen exit on disconnection
  useEffect(() => {
    if (connectionStatus === "disconnected" && isFullscreen) {
      exitFullscreen();
    }
  }, [connectionStatus, isFullscreen, exitFullscreen]);

  // Monitor video element health to detect blank screens
  useEffect(() => {
    if (connectionStatus === "connected" && !isSharing) {
      const checkVideoHealth = () => {
        const videoElement = videoRef.current;
        if (videoElement && currentStreamRef.current) {
          // Check if video is actually playing and has content
          if (
            videoElement.paused ||
            videoElement.ended ||
            videoElement.currentTime === 0
          ) {
            // Force a connection check
            if (webrtcManagerRef.current) {
              const peerConnection = (webrtcManagerRef.current as any)
                .peerConnection;
              if (
                peerConnection &&
                peerConnection.connectionState !== "connected"
              ) {
                setConnectionStatus("disconnected");
                setDisconnectionReason(
                  "Video stream stopped - connection may be lost"
                );
                if (isFullscreen) {
                  exitFullscreen();
                }
              }
            }
          }
        }
      };

      // Check video health every 3 seconds
      const healthInterval = setInterval(checkVideoHealth, 3000);
      return () => clearInterval(healthInterval);
    }
  }, [connectionStatus, isSharing, exitFullscreen]);

  // Optimized mouse event handlers
  const getRelativeMousePosition = useCallback(
    (event: React.MouseEvent<HTMLVideoElement>) => {
      const video = event.currentTarget;
      const rect = video.getBoundingClientRect();

      const relativeX = (event.clientX - rect.left) / rect.width;
      const relativeY = (event.clientY - rect.top) / rect.height;

      return {
        x: Math.max(0, Math.min(1, relativeX)),
        y: Math.max(0, Math.min(1, relativeY)),
      };
    },
    []
  );

  const handleMouseMove = useCallback(
    (event: React.MouseEvent<HTMLVideoElement>) => {
      if (
        !mouseControlEnabled ||
        !webrtcManagerRef.current ||
        connectionStatus !== "connected"
      ) {
        return;
      }

      const now = Date.now();
      if (now - lastMouseMoveRef.current < 16) return; // ~60 FPS
      lastMouseMoveRef.current = now;

      const { x, y } = getRelativeMousePosition(event);
      webrtcManagerRef.current.sendMouseEvent("mouse_move", x, y);
    },
    [mouseControlEnabled, connectionStatus, getRelativeMousePosition]
  );

  const handleMouseDown = useCallback(
    (event: React.MouseEvent<HTMLVideoElement>) => {
      event.preventDefault();
    },
    []
  );

  const handleMouseUp = useCallback(
    (event: React.MouseEvent<HTMLVideoElement>) => {
      event.preventDefault();
    },
    []
  );

  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLVideoElement>) => {
      if (
        !mouseControlEnabled ||
        !webrtcManagerRef.current ||
        connectionStatus !== "connected"
      ) {
        return;
      }

      event.preventDefault();
      const { x, y } = getRelativeMousePosition(event);
      const button =
        event.button === 0 ? "left" : event.button === 2 ? "right" : "middle";
      webrtcManagerRef.current.sendMouseEvent("mouse_click", x, y, button);
    },
    [mouseControlEnabled, connectionStatus, getRelativeMousePosition]
  );

  const handleContextMenu = useCallback(
    (event: React.MouseEvent<HTMLVideoElement>) => {
      event.preventDefault();
    },
    []
  );

  const handleWheel = useCallback(
    (event: React.WheelEvent<HTMLVideoElement>) => {
      if (
        !mouseControlEnabled ||
        !webrtcManagerRef.current ||
        connectionStatus !== "connected"
      ) {
        return;
      }

      event.preventDefault();
      const deltaY = event.deltaY;
      const deltaX = event.deltaX;

      // Send scroll events as keyboard events (PageUp/PageDown for vertical, ArrowLeft/ArrowRight for horizontal)
      if (deltaY !== 0) {
        const scrollKey = deltaY > 0 ? "PageDown" : "PageUp";
        webrtcManagerRef.current.sendKeyboardEvent(
          "key_down",
          scrollKey,
          scrollKey,
          false,
          false,
          false,
          false
        );
        setTimeout(() => {
          webrtcManagerRef.current?.sendKeyboardEvent(
            "key_up",
            scrollKey,
            scrollKey,
            false,
            false,
            false,
            false
          );
        }, 50);
      }
      if (deltaX !== 0) {
        const scrollKey = deltaX > 0 ? "ArrowRight" : "ArrowLeft";
        webrtcManagerRef.current.sendKeyboardEvent(
          "key_down",
          scrollKey,
          scrollKey,
          false,
          false,
          false,
          false
        );
        setTimeout(() => {
          webrtcManagerRef.current?.sendKeyboardEvent(
            "key_up",
            scrollKey,
            scrollKey,
            false,
            false,
            false,
            false
          );
        }, 50);
      }
    },
    [mouseControlEnabled, connectionStatus]
  );

  return (
    <React.Fragment>
      <Head>
        <title>peoplo - Connect</title>
      </Head>

      <div
        className={`${
          isFullscreen
            ? "fixed inset-0 bg-black z-50 overflow-hidden"
            : "min-h-screen bg-gray-50 dark:bg-gray-900"
        }`}
      >
        {/* Permission Dialog */}
        {showPermissionDialog && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 p-8 max-w-md mx-4">
              <div className="text-center">
                <div className="mx-auto mb-4 w-16 h-16 bg-primary-500/20 rounded-full flex items-center justify-center border border-primary-500/30">
                  <svg
                    className="w-8 h-8 text-primary-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z"
                    />
                  </svg>
                </div>
                <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
                  Permission Request
                </h3>
                <p className="text-gray-700 dark:text-gray-300 mb-6">
                  Someone wants to connect to your screen. Do you want to allow
                  this connection?
                </p>
                <div className="flex space-x-4">
                  <button
                    onClick={() => handlePermissionResponse(false)}
                    className="flex-1 btn-secondary"
                  >
                    Decline
                  </button>
                  <button
                    onClick={() => handlePermissionResponse(true)}
                    className="flex-1 btn-success"
                  >
                    Accept
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Session Error Popup */}
        {showSessionErrorPopup && sessionErrorDetails && (
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50"
            onClick={() => setShowSessionErrorPopup(false)}
          >
            <div
              className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 p-8 max-w-md mx-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="text-center">
                <div className="mx-auto mb-4 w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center border border-red-500/30">
                  <svg
                    className="w-8 h-8 text-red-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"
                    />
                  </svg>
                </div>
                <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
                  {sessionErrorDetails.title}
                </h3>
                <p className="text-gray-700 dark:text-gray-300 mb-6">
                  {sessionErrorDetails.message}
                </p>
                {sessionErrorDetails.sessionId && (
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-6 font-mono">
                    Session ID: {sessionErrorDetails.sessionId}
                  </p>
                )}
                <div className="flex space-x-4 justify-center">
                  <button
                    onClick={() => setShowSessionErrorPopup(false)}
                    className="px-6 py-2 bg-gray-500 hover:bg-gray-600 text-white rounded-lg transition-colors font-medium"
                  >
                    Close
                  </button>
                  <button
                    onClick={handleSessionRefresh}
                    className="px-6 py-2 bg-primary-500 hover:bg-primary-600 text-white rounded-lg transition-colors font-medium"
                  >
                    <svg
                      className="w-4 h-4 inline mr-2"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                      />
                    </svg>
                    Refresh Sessions
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Fullscreen Controls */}
        {isFullscreen && !isSharing && (
          <div
            className="fixed top-4 right-4 flex space-x-2"
            style={{ zIndex: 9999 }}
          >
            {debugMode && (
              <div className="bg-white/90 dark:bg-gray-800/90 backdrop-blur-sm border border-gray-300/50 dark:border-gray-600/50 text-gray-900 dark:text-white p-3 rounded-lg text-xs shadow-lg">
                <div>Status: {connectionStatus}</div>
                <div>Fullscreen: {isFullscreen ? "Yes" : "No"}</div>
                <div>
                  Stream: {currentStreamRef.current ? "Active" : "None"}
                </div>
                <div>
                  Video Paused: {videoRef.current?.paused ? "Yes" : "No"}
                </div>
                <div>Video Ended: {videoRef.current?.ended ? "Yes" : "No"}</div>
                <div>Session: {mySessionId}</div>
                <div>Remote: {remoteSessionId}</div>
                <button
                  onClick={() => testSupabaseConnection()}
                  className="mt-2 px-2 py-1 bg-blue-600 text-white rounded text-xs"
                >
                  Test DB
                </button>
                <button
                  onClick={() => addToRecentSessions("1234567890")}
                  className="mt-1 px-2 py-1 bg-green-600 text-white rounded text-xs"
                >
                  Test Add
                </button>
              </div>
            )}
            <button
              onClick={exitFullscreen}
              className="bg-white/80 hover:bg-white/95 dark:bg-gray-800/80 dark:hover:bg-gray-800/95 backdrop-blur-sm border border-gray-300/50 dark:border-gray-600/50 text-gray-900 dark:text-white p-3 rounded-lg transition-all duration-200 shadow-lg hover:shadow-xl"
              title="Exit Fullscreen (ESC)"
            >
              <svg
                className="w-6 h-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
            <button
              onClick={disconnect}
              className="bg-red-600/80 hover:bg-red-600/95 backdrop-blur-sm border border-red-500/50 text-white p-3 rounded-lg transition-all duration-200 shadow-lg hover:shadow-xl"
              title="Disconnect"
            >
              <svg
                className="w-6 h-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728L5.636 5.636"
                />
              </svg>
            </button>
            <button
              onClick={() => setDebugMode(!debugMode)}
              className="bg-gray-600/80 hover:bg-gray-600/95 backdrop-blur-sm border border-gray-500/50 text-white p-3 rounded-lg transition-all duration-200 shadow-lg hover:shadow-xl"
              title="Toggle Debug"
            >
              <svg
                className="w-6 h-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </button>
          </div>
        )}

        {!isFullscreen && (
          <div>
            <div className="flex items-center justify-end pt-4 pr-4">
              <button
                onClick={logout}
                className="p-3 text-sm bg-red-600 hover:bg-red-700 text-white rounded-lg transition-all duration-200 font-medium hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-opacity-50"
              >
                <svg
                  className="w-4 h-4 inline"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                  />
                </svg>
              </button>
            </div>
            <div className="container mx-auto px-6 py-8">
              {/* Header */}
              <div className="flex items-center mb-8">
                <LogoutButton
                  mySessionId={mySessionId}
                  copySessionId={copySessionId}
                />
              </div>

              {/* Your Address Section */}
              {/* <div className="card-gradient p-6 mb-8 hover-lift">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-4">
                    <div className="w-12 h-12 bg-primary-500 rounded-lg flex items-center justify-center shadow-primary">
                      <svg
                        className="w-6 h-6 text-gray-900 dark:text-white"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                        />
                      </svg>
                    </div>
                    <div>
                      <h2 className="text-lg font-semibold text-gradient-primary mb-1">
                        Your Address
                      </h2>
                      <div className="flex items-center space-x-3">
                        <span className="text-2xl font-bold text-primary-600 dark:text-primary-400 font-mono bg-gray-100 dark:bg-gray-800 px-3 py-1 rounded-lg border border-primary-500/20">
                          {mySessionId}
                        </span>
                        <button
                          onClick={copySessionId}
                          className="text-gray-600 dark:text-gray-400 hover:text-primary-400 transition-colors p-2 rounded-lg hover:bg-primary-500/10"
                          title="Copy Session ID"
                        >
                          <svg
                            className="w-5 h-5"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                            />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center space-x-4">
                    <div className="flex items-center space-x-2">
                      <div
                        className={`w-3 h-3 rounded-full ${
                          isSharing ? "status-online" : "status-offline"
                        }`}
                      ></div>
                      <span className="text-gray-700 dark:text-gray-300 text-sm">
                        {isSharing ? "Sharing" : "Ready"}
                      </span>
                    </div>
                    {isSharing && (
                      <button
                        onClick={disconnect}
                        className="btn-danger text-sm flex items-center space-x-2"
                      >
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M6 18L18 6M6 6l12 12"
                          />
                        </svg>
                        <span>Stop Sharing</span>
                      </button>
                    )}
                  </div>
                </div>
              </div> */}

              {/* Connect Section */}
              <div className="card-gradient p-6 mb-8 ">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-gradient-accent mb-4">
                    Connect to Remote
                  </h2>
                  {isSharing && (
                    <button
                      onClick={disconnect}
                      className="btn-danger text-sm flex items-center space-x-2"
                    >
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                      <span>Stop Sharing</span>
                    </button>
                  )}
                </div>

                <div className="flex space-x-4 mt-4">
                  <div className="flex-1">
                    <input
                      type="text"
                      value={remoteSessionId}
                      onChange={(e) =>
                        setRemoteSessionId(e.target.value.toUpperCase())
                      }
                      placeholder="Enter remote session ID"
                      className="input-primary"
                      maxLength={10}
                      disabled={connectionStatus === "connected"}
                    />
                  </div>
                  <button
                    onClick={() => connectToRemote()}
                    disabled={
                      connectionStatus === "connecting" ||
                      connectionStatus === "waiting_for_permission" ||
                      connectionStatus === "connected" ||
                      !remoteSessionId.trim()
                    }
                    className="btn-primary disabled:bg-gray-600 disabled:shadow-none flex items-center space-x-2"
                  >
                    {connectionStatus === "connecting" ||
                    connectionStatus === "waiting_for_permission" ? (
                      <>
                        <svg
                          className="animate-spin w-5 h-5"
                          fill="none"
                          viewBox="0 0 24 24"
                        >
                          <circle
                            className="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="4"
                          ></circle>
                          <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                          ></path>
                        </svg>
                        <span>Connecting...</span>
                      </>
                    ) : (
                      <>
                        <svg
                          className="w-5 h-5"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M13 10V3L4 14h7v7l9-11h-7z"
                          />
                        </svg>
                        <span>Connect</span>
                      </>
                    )}
                  </button>
                </div>

                {errorMessage && (
                  <div className="mt-4 p-4 bg-red-900/20 border border-red-500/30 rounded-lg backdrop-blur-sm">
                    <div className="flex items-center space-x-2">
                      <svg
                        className="w-5 h-5 text-red-400"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                        />
                      </svg>
                      <span className="text-red-200">{errorMessage}</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Recent Sessions */}
              <div className="card-gradient p-6 mb-8">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-gradient-accent">
                    Recent Sessions
                  </h2>
                  <button
                    onClick={loadRecentSessions}
                    disabled={loadingRecentSessions}
                    className="text-gray-600 dark:text-gray-400 hover:text-primary-400 p-2 rounded-lg hover:bg-primary-500/10 transition-colors disabled:opacity-50"
                    title="Refresh recent sessions"
                  >
                    <svg
                      className="w-5 h-5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                      />
                    </svg>
                  </button>
                </div>
                {loadingRecentSessions ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="loading-spinner h-8 w-8"></div>
                    <span className="ml-3 text-gray-600 dark:text-gray-400">
                      Loading recent sessions...
                    </span>
                  </div>
                ) : recentSessions.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    {recentSessions.map((session) => (
                      <div
                        key={session.id}
                                                  className={`recent-session-card ${getSessionCardColor(
                           session.session_id
                          )} p-5 transition-all duration-300 relative group shadow-lg rounded-xl`}
                        // onClick={() =>
                        //   handleConnectToRecent(session.session_id.toString())
                        // }
                        title={
                          session.isActive
                            ? "Click to connect to this session"
                            : "This session is currently offline"
                        }
                      >
                        {/* Header with status and actions */}
                        <div className="flex items-center justify-between mb-4">
                          <div className="flex items-center space-x-3">
                            <div className="relative">
                              <div className="w-10 h-10 bg-blue-500 rounded-lg flex items-center justify-center shadow-lg">
                                <svg
                                  className="w-5 h-5 text-white"
                                  fill="currentColor"
                                  viewBox="0 0 24 24"
                                >
                                  <path d="M21 2H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h7l-2 3v1h8v-1l-2-3h7c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 12H3V4h18v10z" />
                                </svg>
                              </div>
                              <div
                                className={`absolute -top-1 -right-1 w-4 h-4 rounded-full ${
                                  session.isActive
                                    ? "status-online"
                                    : "bg-red-500 border-2 border-gray-200 dark:border-gray-800"
                                }`}
                              ></div>
                            </div>
                            <div>
                              <h3 className="session-card-text-primary text-lg">
                                {session.first_name && session.last_name
                                  ? `${session.first_name} ${session.last_name}`
                                  : "Remote Session"}
                              </h3>
                              {/* <p
                                className={`text-sm ${
                                  session.isActive
                                    ? "text-green-400"
                                    : "text-red-400"
                                }`}
                              >
                                {session.isActive
                                  ? "● Online - Ready to connect"
                                  : "● Offline - Not available"}
                              </p> */}
                            </div>
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedSession(
                                selectedSession ===
                                  session.session_id.toString()
                                  ? null
                                  : session.session_id.toString()
                              );
                            }}
                            className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white p-2 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-all duration-200"
                          >
                            <svg
                              className="w-5 h-5"
                              fill="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" />
                            </svg>
                          </button>
                        </div>

                        {/* Session ID Section */}
                        <div className="bg-white/60 dark:bg-gray-800/60 backdrop-blur-sm rounded-lg p-3 mb-3 border border-gray-200/50 dark:border-gray-600/50">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-2">
                              <svg
                                className="w-4 h-4 text-primary-400"
                                fill="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
                              </svg>
                              <span className="text-primary-400 font-mono font-bold text-lg">
                                {session.session_id}
                              </span>
                            </div>
                            <button
                              title="Connect"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleConnectToRecent(
                                  session.session_id.toString()
                                );
                              }}
                              className="p-1 rounded   transition-colors"
                            >
                              <svg
                                className="w-5 h-5 text-primary-400"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M13 7l5 5m0 0l-5 5m5-5H6"
                                />
                              </svg>
                            </button>
                          </div>
                        </div>

                        {/* Quick Actions */}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-2">
                            <div className="flex items-center space-x-1 session-card-text-muted">
                              <svg
                                className="w-3 h-3"
                                fill="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
                              </svg>
                              <span>Remote Desktop</span>
                            </div>
                          </div>
                          <div className="flex items-center space-x-1">
                            <div
                              className={`w-2 h-2 rounded-full ${
                                session.status === "online"
                                  ? "bg-green-500 animate-pulse"
                                  : "bg-red-500"
                              }`}
                            ></div>
                            <span
                              className={`text-xs font-medium ${
                                session.status === "online"
                                  ? "text-green-400"
                                  : "text-red-400"
                              }`}
                            >
                              {session.status}
                            </span>
                          </div>
                        </div>

                        {/* Action Menu */}
                        {selectedSession === session.session_id.toString() && (
                          <div className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-gray-600 rounded-lg shadow-lg z-10 border border-gray-200 dark:border-gray-500">
                            <div className="p-2 space-y-1">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleConnectToRecent(
                                    session.session_id.toString()
                                  );
                                }}
                                className="w-full text-left px-3 py-2 text-sm text-gray-900 dark:text-white hover:bg-gray-100 dark:hover:bg-gray-500 rounded transition-colors flex items-center space-x-2"
                              >
                                <svg
                                  className="w-4 h-4"
                                  fill="none"
                                  stroke="currentColor"
                                  viewBox="0 0 24 24"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M13 7l5 5m0 0l-5 5m5-5H6"
                                  />
                                </svg>
                                <span>Connect</span>
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleRemoveFromRecent(
                                    session.session_id.toString()
                                  );
                                }}
                                className="w-full text-left px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-gray-100 dark:hover:bg-gray-500 rounded transition-colors flex items-center space-x-2"
                              >
                                <svg
                                  className="w-4 h-4"
                                  fill="none"
                                  stroke="currentColor"
                                  viewBox="0 0 24 24"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                                  />
                                </svg>
                                <span>Remove</span>
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-600 dark:text-gray-400">
                    <svg
                      className="w-12 h-12 mx-auto mb-4 text-gray-500 dark:text-gray-600"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M21 2H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h7l-2 3v1h8v-1l-2-3h7c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 12H3V4h18v10z"
                      />
                    </svg>
                    <p>No recent sessions</p>
                    <p className="text-sm mt-1">
                      Connect to a session to see it here
                    </p>
                  </div>
                )}
              </div>

              {/* Remote Screen Display */}
              {connectionStatus === "connected" && !isSharing && (
                <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                      Remote Screen
                    </h2>
                    <div className="flex space-x-2">
                      <button
                        onClick={enterFullscreen}
                        className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors flex items-center space-x-2"
                      >
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"
                          />
                        </svg>
                        <span>Fullscreen</span>
                      </button>
                      {/* <button
                      onClick={disconnect}
                      className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors flex items-center space-x-2"
                    >
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                      <span>Disconnect</span>
                    </button> */}
                    </div>
                  </div>

                  <div className="bg-gray-900 rounded-lg overflow-hidden aspect-video relative">
                    <video
                      ref={videoRef}
                      autoPlay
                      muted
                      playsInline
                      className="w-full h-full object-contain cursor-none"
                      onPause={() => {
                        if (
                          connectionStatus === "connected" &&
                          currentStreamRef.current
                        ) {
                          // Try to resume the video
                          videoRef.current?.play().catch(() => {
                            setConnectionStatus("disconnected");
                            setDisconnectionReason(
                              "Video stream paused - connection may be lost"
                            );
                            if (isFullscreen) {
                              exitFullscreen();
                            }
                          });
                        }
                      }}
                      onEnded={() => {
                        if (connectionStatus === "connected") {
                          setConnectionStatus("disconnected");
                          setDisconnectionReason(
                            "Video stream ended - connection may be lost"
                          );
                          if (isFullscreen) {
                            exitFullscreen();
                          }
                        }
                      }}
                      {...(mouseControlEnabled &&
                      connectionStatus === "connected"
                        ? {
                            onMouseMove: handleMouseMove,
                            onMouseDown: handleMouseDown,
                            onMouseUp: handleMouseUp,
                            onClick: handleClick,
                            onContextMenu: handleContextMenu,
                            onWheel: handleWheel,
                          }
                        : {})}
                      style={{
                        pointerEvents:
                          mouseControlEnabled &&
                          connectionStatus === "connected"
                            ? "auto"
                            : "none",
                      }}
                    />
                    {connectionStatus !== "connected" && (
                      <div className="absolute inset-0 flex items-center justify-center bg-gray-900">
                        <div className="text-center">
                          <svg
                            className="w-16 h-16 mx-auto mb-4 text-gray-600"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192L5.636 18.364M12 2.25a9.75 9.75 0 100 19.5 9.75 9.75 0 000-19.5z"
                            />
                          </svg>
                          <p className="text-gray-400 text-lg font-medium">
                            {connectionStatus === "disconnected" &&
                            disconnectionReason
                              ? "Connection Lost"
                              : "Disconnected"}
                          </p>
                          <p className="text-gray-500 text-sm mt-1">
                            {disconnectionReason || "The host has disconnected"}
                          </p>
                          {connectionStatus === "disconnected" &&
                            disconnectionReason && (
                              <button
                                onClick={() => {
                                  setDisconnectionReason("");
                                  setConnectionStatus("disconnected");
                                }}
                                className="mt-4 btn-primary text-sm"
                              >
                                Clear Message
                              </button>
                            )}
                        </div>
                      </div>
                    )}
                    <style jsx>{`
                      video::-webkit-media-controls {
                        display: none !important;
                      }
                      video::-webkit-media-controls-panel {
                        display: none !important;
                      }
                      video::-webkit-media-controls-play-button {
                        display: none !important;
                      }
                      video::-webkit-media-controls-timeline {
                        display: none !important;
                      }
                      video::-webkit-media-controls-current-time-display {
                        display: none !important;
                      }
                      video::-webkit-media-controls-time-remaining-display {
                        display: none !important;
                      }
                      video::-webkit-media-controls-volume-slider {
                        display: none !important;
                      }
                      video::-webkit-media-controls-mute-button {
                        display: none !important;
                      }
                      video::-webkit-media-controls-fullscreen-button {
                        display: none !important;
                      }
                    `}</style>
                  </div>

                  {/* Control Options */}
                  <div className="mt-4 flex items-center justify-between">
                    <div className="flex items-center space-x-6">
                      <div className="flex items-center space-x-2">
                        <span className="text-gray-700 dark:text-gray-300 text-sm">
                          Mouse Control: Enabled
                        </span>
                        <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                      </div>
                      <div className="flex items-center space-x-2">
                        <span className="text-gray-700 dark:text-gray-300 text-sm">
                          Keyboard Control: Enabled
                        </span>
                        <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                      </div>
                    </div>
                    {hostResolution && (
                      <div className="text-gray-400 text-sm">
                        Resolution: {hostResolution.width} ×{" "}
                        {hostResolution.height}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Fullscreen Video - Always rendered but hidden when not in fullscreen */}
        <div
          className={`fixed inset-0 bg-black z-50 ${
            isFullscreen ? "block" : "hidden"
          }`}
        >
          <video
            ref={fullscreenVideoRef}
            autoPlay
            muted
            playsInline
            className="w-full h-full object-contain cursor-none"
            onPause={() => {
              if (
                connectionStatus === "connected" &&
                currentStreamRef.current
              ) {
                // Try to resume the video
                fullscreenVideoRef.current?.play().catch(() => {
                  setConnectionStatus("disconnected");
                  setDisconnectionReason(
                    "Video stream paused - connection may be lost"
                  );
                  if (isFullscreen) {
                    exitFullscreen();
                  }
                });
              }
            }}
            onEnded={() => {
              if (connectionStatus === "connected") {
                setConnectionStatus("disconnected");
                setDisconnectionReason(
                  "Video stream ended - connection may be lost"
                );
                if (isFullscreen) {
                  exitFullscreen();
                }
              }
            }}
            {...(isFullscreen &&
            mouseControlEnabled &&
            connectionStatus === "connected"
              ? {
                  onMouseMove: handleMouseMove,
                  onMouseDown: handleMouseDown,
                  onMouseUp: handleMouseUp,
                  onClick: handleClick,
                  onContextMenu: handleContextMenu,
                  onWheel: handleWheel,
                }
              : {})}
            style={{
              pointerEvents:
                mouseControlEnabled &&
                connectionStatus === "connected" &&
                isFullscreen
                  ? "auto"
                  : "none",
            }}
          />
          <style jsx>{`
            video::-webkit-media-controls {
              display: none !important;
            }
            video::-webkit-media-controls-panel {
              display: none !important;
            }
            video::-webkit-media-controls-play-button {
              display: none !important;
            }
            video::-webkit-media-controls-timeline {
              display: none !important;
            }
            video::-webkit-media-controls-current-time-display {
              display: none !important;
            }
            video::-webkit-media-controls-time-remaining-display {
              display: none !important;
            }
            video::-webkit-media-controls-volume-slider {
              display: none !important;
            }
            video::-webkit-media-controls-mute-button {
              display: none !important;
            }
            video::-webkit-media-controls-fullscreen-button {
              display: none !important;
            }
          `}</style>
          {connectionStatus !== "connected" && (
            <div className="absolute inset-0 flex items-center justify-center text-white">
              <div className="text-center">
                <svg
                  className="w-16 h-16 mx-auto mb-4 opacity-50"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192L5.636 18.364M12 2.25a9.75 9.75 0 100 19.5 9.75 9.75 0 000-19.5z"
                  />
                </svg>
                <p className="text-lg font-medium">
                  {connectionStatus === "disconnected" && disconnectionReason
                    ? "Connection Lost"
                    : "No remote connection"}
                </p>
                <p className="text-sm opacity-75">
                  {disconnectionReason ||
                    "Connect to a session to view remote screen"}
                </p>
                <p className="text-xs opacity-50 mt-2">
                  Press ESC to exit fullscreen
                </p>
                {connectionStatus === "disconnected" && disconnectionReason && (
                  <button
                    onClick={() => {
                      setDisconnectionReason("");
                      setConnectionStatus("disconnected");
                    }}
                    className="mt-4 btn-primary text-sm"
                  >
                    Clear Message
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </React.Fragment>
  );
}
