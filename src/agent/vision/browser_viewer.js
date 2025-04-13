import settings from '../../../settings.js';
import prismarineViewer from 'prismarine-viewer';
import WebSocket from 'ws';

const mineflayerViewer = prismarineViewer.mineflayer;

// Track active WebSocket connections for cleanup
const activeConnections = new Map();

export function addBrowserViewer(bot, count_id) {
    if (settings.show_bot_views) {
        // Default options for viewer
        const viewerOptions = { 
            port: 3000+count_id, 
            firstPerson: true, 
            frames: 60, 
            viewDistance: 12
        };
        
        // Add WebSocket streaming if enabled
        if (settings.stream_bot_views) {
            let wsClient = null;
            
            // Connect to WebSocket server
            try {
                wsClient = new WebSocket(settings.stream_ws_url || 'ws://localhost:8080');
                
                // Store connection for cleanup
                activeConnections.set(bot.username, wsClient);
                
                wsClient.on('open', () => {
                    console.log(`WebSocket connection established for bot ${bot.username}`);
                    
                    // Send bot info for identification
                    wsClient.send(JSON.stringify({
                        type: 'bot_info',
                        username: bot.username,
                        id: count_id
                    }));
                });
                
                wsClient.on('error', (err) => {
                    console.error(`WebSocket error for bot ${bot.username}:`, err);
                });
                
                wsClient.on('close', () => {
                    console.log(`WebSocket connection closed for bot ${bot.username}`);
                    activeConnections.delete(bot.username);
                });
                
                // Setup frame capture
                viewerOptions.onFrame = (canvas) => {
                    if (wsClient && wsClient.readyState === WebSocket.OPEN) {
                        // Convert canvas to binary data
                        canvas.toBuffer((err, buf) => {
                            if (!err) {
                                wsClient.send(buf);
                            }
                        }, 'image/jpeg', { 
                            quality: settings.stream_quality || 0.7 
                        });
                    }
                };
                
                // Cleanup on bot end
                bot.on('end', () => {
                    if (wsClient && wsClient.readyState === WebSocket.OPEN) {
                        wsClient.close();
                        activeConnections.delete(bot.username);
                    }
                });
            } catch (err) {
                console.error(`Failed to initialize WebSocket for bot ${bot.username}:`, err);
            }
        }
        
        // Initialize the viewer with our options
        return mineflayerViewer(bot, viewerOptions);
    }
    return null;
}

// Helper to close all active connections
export function closeAllConnections() {
    for (const [botName, conn] of activeConnections.entries()) {
        if (conn.readyState === WebSocket.OPEN) {
            console.log(`Closing WebSocket connection for bot ${botName}`);
            conn.close();
        }
    }
    activeConnections.clear();
}