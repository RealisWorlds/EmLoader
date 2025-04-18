import prismarineViewer from 'prismarine-viewer';
import { createCanvas } from 'node-canvas-webgl';
import settings from '../../../settings.js';

// Required for headless rendering
globalThis.createCanvas = createCanvas;

export function addBrowserViewer(bot, count_id) {
    if (!settings.show_bot_views) return;
  
    // Set up global error handler for uncaught exceptions related to this connection
    const errorHandler = (err) => {
      if (err.code === 'ECONNREFUSED' && err.port === (settings.viewer_stream_port || 8089 + count_id)) {
        console.error(`Connection refused for headless viewer (bot ${bot.username}):`, err);
        // Remove this handler after catching the specific error
        process.removeListener('uncaughtException', errorHandler);
      }
    };
  
    // Add temporary global error handler
    process.on('uncaughtException', errorHandler);
  
    try {
      const { headless } = prismarineViewer; // ESM-compatible default import destructuring
      
      // Check if headless is defined before trying to use it
      if (!headless) {
        throw new Error('Headless viewer not available in prismarineViewer');
      }
      
      // Start headless viewer
      const viewer = headless(bot, {
        width: 1024,
        height: 768,
        viewDistance: 12,
        firstPerson: true,
        frames: -1,
        framesLimit: 1000,
        output: `127.0.0.1:${settings.viewer_stream_port || 8089 + count_id}` // optional per-bot port
      });
      
      // If we got a viewer instance back, we can set up error handlers on it
      if (viewer && typeof viewer.on === 'function') {
        viewer.on('error', (error) => {
          console.error(`Viewer listener offline for bot: ${bot.username}`);
          // Clean up global handler if viewer has its own error handling
          process.removeListener('uncaughtException', errorHandler);
        });
      }
      
      console.log(`Headless viewer started for bot ${bot.username} on port ${settings.viewer_stream_port || 8089 + count_id}`);
      
      // Set a timeout to remove the global handler if no error occurs within a reasonable time
      setTimeout(() => {
        process.removeListener('uncaughtException', errorHandler);
      }, 10000); // 10 second timeout
      
    } catch (error) {
      console.error(`Failed to start headless viewer for bot ${bot.username}:`, error);
      // Clean up global handler on caught errors
      process.removeListener('uncaughtException', errorHandler);
    }
  }
