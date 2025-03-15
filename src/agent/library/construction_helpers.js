/**
 * Construction helper functions for complex building tasks
 * These functions help prevent disconnections by implementing rate limiting and error handling
 */

import Vec3 from 'vec3';
import * as skills from './skills.js';

/**
 * Builds a spiral structure with rate-limiting to prevent disconnections
 * @param {MinecraftBot} bot - The bot instance
 * @param {Object} options - Configuration options
 * @param {Vec3} options.startPosition - Starting position for the build
 * @param {number} options.height - Total height of the spiral
 * @param {number} options.radiusStart - Starting radius at the bottom
 * @param {number} options.radiusEnd - Ending radius at the top
 * @param {string[]} options.blockTypes - Array of block types to alternate
 * @param {number} options.blocksPerStep - How many blocks to place before pausing
 * @param {number} options.delayBetweenSteps - Milliseconds to wait between steps
 * @returns {Promise<boolean>} - True if completed successfully
 */
export async function buildSpiral(bot, options) {
    const {
        startPosition = bot.entity.position,
        height = 10,
        radiusStart = 3,
        radiusEnd = 5,
        blockTypes = ['stone', 'cobblestone'],
        blocksPerStep = 10, 
        delayBetweenSteps = 10
    } = options;

    // Log the start of construction
    bot.chat("Starting spiral construction...");
    
    try {
        // Calculate how radius changes with height
        const radiusIncrement = (radiusEnd - radiusStart) / height;
        
        // For each vertical layer
        for (let y = 0; y < height; y++) {
            const currentRadius = radiusStart + (radiusIncrement * y);
            const circumference = Math.ceil(2 * Math.PI * currentRadius);
            const angleStep = (2 * Math.PI) / circumference;
            
            // Use the appropriate block type in alternating fashion
            const blockType = blockTypes[y % blockTypes.length];
            
            // Place blocks around the circle
            let blocksPlacedInStep = 0;
            for (let i = 0; i < circumference; i++) {
                const angle = i * angleStep;
                const x = Math.floor(startPosition.x + (Math.cos(angle) * currentRadius));
                const z = Math.floor(startPosition.z + (Math.sin(angle) * currentRadius));
                
                // Attempt to place the block, with error handling
                try {
                    await skills.placeBlock(bot, blockType, x, startPosition.y + y, z);
                    
                    // Count blocks placed and pause if needed to prevent overloading
                    blocksPlacedInStep++;
                    if (blocksPlacedInStep >= blocksPerStep) {
                        await new Promise(resolve => setTimeout(resolve, delayBetweenSteps));
                        bot.chat(`Building spiral: ${Math.floor((y / height) * 100)}% complete...`);
                        blocksPlacedInStep = 0;
                    }
                } catch (err) {
                    console.error(`Error placing block at (${x}, ${startPosition.y + y}, ${z}): ${err}`);
                    // Continue to next block rather than failing entirely
                    continue;
                }
            }
            
            // Pause between layers to allow the server to catch up
            await new Promise(resolve => setTimeout(resolve, delayBetweenSteps));
        }
        
        bot.chat("Spiral construction complete!");
        return true;
    } catch (error) {
        console.error("Error in spiral construction:", error);
        bot.chat("Spiral construction failed!");
        return false;
    }
}

/**
 * Builds a tornado structure with proper error handling and rate limiting
 * @param {MinecraftBot} bot - The bot instance
 * @param {Object} options - Configuration options
 * @param {Vec3} options.startPosition - Starting position for the tornado
 * @param {number} options.height - Height of the tornado in blocks
 * @param {number} options.baseRadius - Starting radius at the bottom
 * @param {number} options.topRadius - Ending radius at the top
 * @param {string[]} options.blockTypes - Block types to use (alternating)
 * @param {number} options.offsetIncrement - How much to offset each layer
 * @param {number} options.offsetRepeat - How many times to repeat offset pattern
 * @returns {Promise<boolean>} - True if completed successfully
 */
export async function buildTornado(bot, options) {
    const {
        startPosition = bot.entity.position,
        height = 50,
        baseRadius = 5,
        topRadius = 10,
        blockTypes = ['glowstone', 'verdant_froglight'],
        offsetIncrement = 1,
        offsetRepeat = 10,
        blocksPerStep = 5,
        delayBetweenSteps = 10
    } = options;

    try {
        // Log start of construction
        bot.chat("Starting tornado construction...");
        
        // Calculate radius change per block height
        const radiusChange = (topRadius - baseRadius) / height;
        
        // Track current offset and reset after reaching offsetRepeat
        let currentOffset = 0;
        let offsetCounter = 0;
        
        for (let y = 0; y < height; y++) {
            // Calculate current radius at this height
            const currentRadius = baseRadius + (y * radiusChange);
            
            // Update offset based on repeat pattern
            offsetCounter++;
            if (offsetCounter >= offsetRepeat) {
                currentOffset += offsetIncrement;
                offsetCounter = 0;
            }
            
            // Calculate number of blocks needed for this ring
            const blocksInRing = Math.ceil(2 * Math.PI * currentRadius);
            const angleStep = (2 * Math.PI) / blocksInRing;
            
            // Select block type for this layer (alternating)
            const blockType = blockTypes[y % blockTypes.length];
            
            // Track blocks placed for rate limiting
            let blocksPlacedInStep = 0;
            
            // Place blocks in a circle with offset
            for (let i = 0; i < blocksInRing; i++) {
                const angle = i * angleStep;
                
                // Add offset to create spiral effect
                const offsetAngle = angle + (currentOffset * (Math.PI / 180));
                
                const x = Math.floor(startPosition.x + (Math.cos(offsetAngle) * currentRadius));
                const z = Math.floor(startPosition.z + (Math.sin(offsetAngle) * currentRadius));
                
                try {
                    await skills.placeBlock(bot, blockType, x, startPosition.y + y, z);
                    
                    // Apply rate limiting to prevent disconnections
                    blocksPlacedInStep++;
                    if (blocksPlacedInStep >= blocksPerStep) {
                        await new Promise(resolve => setTimeout(resolve, delayBetweenSteps));
                        bot.chat(`Building tornado: ${Math.floor((y / height) * 100)}% complete...`);
                        blocksPlacedInStep = 0;
                    }
                } catch (err) {
                    // Log error but continue building
                    console.error(`Error placing block at (${x}, ${startPosition.y + y}, ${z}): ${err}`);
                    continue;
                }
            }
            
            // Pause between layers
            await new Promise(resolve => setTimeout(resolve, delayBetweenSteps * 2));
            
            // Every 10 layers, provide progress report
            if (y % 10 === 0) {
                bot.chat(`Tornado construction: ${Math.floor((y / height) * 100)}% complete`);
            }
        }
        
        bot.chat("Tornado construction complete!");
        return true;
    } catch (error) {
        console.error("Error in tornado construction:", error);
        bot.chat("Tornado construction failed!");
        return false;
    }
}
