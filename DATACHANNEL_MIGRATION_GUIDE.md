# WebRTC DataChannel Migration Guide

## Overview
This document describes the migration of input events from WebSocket (TCP) to WebRTC DataChannel (UDP) to improve input latency in the remote desktop application.

## Problem Statement
- **Current**: Input events (mouse/keyboard) sent via WebSocket (TCP)
- **Issue**: TCP causes delay due to reliability guarantees
- **Solution**: Migrate to WebRTC DataChannel (UDP) for better latency

## Migration Strategy

### Phase 1: DataChannel Primary (Current Implementation)
- ✅ Send input events via DataChannel when available
- ✅ WebSocket serves as fallback only when DataChannel is not ready
- ✅ DataChannel is the primary method for input events
- ✅ No breaking changes to existing functionality

### Phase 2: Full Migration (Future)
- Switch to DataChannel-only for input events
- Keep WebSocket only for signaling
- Remove WebSocket fallback code

## Implementation Details

### 1. WebRTCManager Updates

#### New Properties
```typescript
private dataChannel: RTCDataChannel | null = null;
private useDataChannelForInput: boolean = false;
```

#### New Methods
- `setupDataChannel()` - Creates DataChannel with optimized settings
- `setupDataChannelHandler()` - Handles incoming DataChannel
- `handleDataChannelMessage()` - Processes DataChannel messages
- `sendDataChannelMessage()` - Sends messages via DataChannel
- `setUseDataChannelForInput()` - Configuration method
- `isDataChannelReady()` - Status check

#### DataChannel Configuration
```typescript
{
  ordered: false,           // Allow out-of-order delivery
  maxRetransmits: 0,        // No retransmission for real-time
}
```

### 2. Input Event Methods Updated

#### Mouse Events (`sendMouseEvent`)
- Uses DataChannel when available
- Falls back to WebSocket only if DataChannel is not ready
- Logs which method was used (except mouse_move to avoid spam)

#### Keyboard Events (`sendKeyboardEvent`)
- Uses DataChannel when available
- Falls back to WebSocket only if DataChannel is not ready
- Logs which method was used

#### Screen Resolution (`sendScreenResolution`)
- Uses DataChannel when available
- Falls back to WebSocket only if DataChannel is not ready
- Logs which method was used

### 3. Message Handling

#### DataChannel Message Types
- `mouse_move`, `mouse_click`, `mouse_down`, `mouse_up`
- `key_down`, `key_up`
- `screen_resolution`

#### Message Format
```typescript
{
  type: string,
  sessionId: string,
  clientId: string,
  mouseData?: { x: number, y: number, button?: string },
  keyboardData?: { key: string, code: string, ... },
  resolution?: { width: number, height: number }
}
```

## Usage Examples

### Basic Setup
```typescript
const webrtcManager = new WebRTCManager();

// Start host with DataChannel
await webrtcManager.startHost('session-123');

// Check DataChannel status
const isReady = webrtcManager.isDataChannelReady();
console.log('DataChannel ready:', isReady);
```

### Sending Input Events
```typescript
// Mouse events (automatically uses DataChannel if available)
webrtcManager.sendMouseEvent('mouse_move', 100, 200);
webrtcManager.sendMouseEvent('mouse_click', 150, 250, 'left');

// Keyboard events (automatically uses DataChannel if available)
webrtcManager.sendKeyboardEvent('key_down', 'a', 'KeyA', false, false, false, false);
```

### Configuration
```typescript
// Enable/disable DataChannel usage
webrtcManager.setUseDataChannelForInput(true);

// Check if DataChannel is ready
if (webrtcManager.isDataChannelReady()) {
  console.log('Using DataChannel for input events');
}
```

## Benefits

### Latency Improvements
- **UDP vs TCP**: Lower latency due to no reliability guarantees
- **Out-of-order delivery**: Better for real-time input
- **No retransmission**: Prevents delayed input events

### Reliability
- **Dual sending**: Ensures compatibility during transition
- **Fallback mechanism**: WebSocket backup if DataChannel fails
- **No breaking changes**: Existing functionality preserved

## Testing

### Test Scenarios
1. **DataChannel Available**: Events sent via DataChannel
2. **DataChannel Unavailable**: Events sent via WebSocket
3. **Mixed Mode**: Both channels active during transition
4. **Connection Issues**: Graceful fallback to WebSocket

### Debug Logging
- DataChannel events: `📡 Sent [event] via DataChannel`
- WebSocket events: `🌐 Sent [event] via WebSocket (DataChannel not available)`
- Status changes: `🔄 DataChannel for input events: enabled/disabled`

## Migration Checklist

- [x] Add DataChannel support to WebRTCManager
- [x] Create DataChannel event handlers
- [x] Implement dual sending mechanism
- [x] Add host-side DataChannel message handling
- [x] Update input event methods
- [x] Add configuration methods
- [x] Update disconnect cleanup
- [x] Test with existing functionality
- [ ] Performance testing
- [ ] Full migration to DataChannel-only
- [ ] Remove WebSocket fallback

## Future Enhancements

### Phase 2: Full Migration
1. Switch to DataChannel-only mode
2. Remove WebSocket fallback code
3. Optimize DataChannel settings further
4. Add connection quality monitoring

### Phase 3: Advanced Features
1. Multiple DataChannels for different event types
2. Compression for large messages
3. Connection quality adaptation
4. Bandwidth monitoring

## Troubleshooting

### Common Issues
1. **DataChannel not opening**: Check WebRTC connection state
2. **Events not received**: Verify message format and handlers
3. **Fallback not working**: Check WebSocket connection

### Debug Steps
1. Check DataChannel readiness: `isDataChannelReady()`
2. Monitor console logs for method usage
3. Verify WebRTC connection state
4. Test with both channels active

## Conclusion

The DataChannel migration provides significant latency improvements for input events while maintaining full backward compatibility. The dual-sending approach ensures a smooth transition without breaking existing functionality.

The implementation is ready for testing and gradual rollout. Once stable, the system can be fully migrated to DataChannel-only mode for optimal performance.
