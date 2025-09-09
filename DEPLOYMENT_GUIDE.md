# 🚀 Deployment Guide

## Frontend Build Fix ✅
The build issue has been resolved by updating `renderer/next.config.js` with proper webpack fallbacks for Node.js modules.

## Backend Deployment to Render

### Step 1: Deploy WebSocket Server
1. Go to [render.com](https://render.com)
2. Sign up/Login with GitHub
3. Click "New +" → "Web Service"
4. Connect your private repository: `peoplo-connect-seperate-app`
5. Configure:
   - **Name**: `deskviewer-websocket-server`
   - **Environment**: `Node`
   - **Root Directory**: `peoplo-connect-clod-server`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Node Version**: `18` or `20`

### Step 2: Environment Variables
Add these in Render dashboard:
```
NODE_ENV=production
PORT=10000
```

### Step 3: Get Your URL
After deployment, copy your Render URL (e.g., `https://deskviewer-websocket-server.onrender.com`)

## Frontend Configuration

### Create Environment File
Create `renderer/.env.local` with:
```env
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url_here
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key_here

# WebSocket Server URL (Replace with your actual Render URL)
NEXT_PUBLIC_WEBSOCKET_URL=wss://your-render-app-name.onrender.com
```

### Update WebSocket URL
Replace `your-render-app-name.onrender.com` with your actual Render app name.

## Testing
1. Deploy backend to Render
2. Update frontend environment variables
3. Build and test frontend locally
4. Deploy frontend (if needed)

## Notes
- Render free tier has some limitations (sleeps after 15 minutes of inactivity)
- For production, consider upgrading to paid plan
- WebSocket connections will reconnect automatically when server wakes up
