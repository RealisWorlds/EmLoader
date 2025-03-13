/**
 * Build command integration
 * Provides structured building capabilities with rate limiting to prevent disconnections
 */

import * as skills from '../library/skills.js';
import { Vector3 } from 'vec3';

/**
 * Command handler for structured building operations
 * @param {Object} params - Command parameters
 * @param {string} params.structure - Structure type to build (tornado, spiral, etc.)
 * @param {Object} params.options - Configuration options for the structure
 * @returns {Promise<Object>} Command execution result
 */
export async function main(bot, params) {
    try {
        // Validate required parameters
        if (!params.structure) {
            return {
                success: false,
                message: "Missing required parameter: structure. Please specify the structure type to build."
            };
        }

        // Default options if not provided
        const options = params.options || {};
        
        // Set default position to the bot's current position if not specified
        if (!options.startPosition) {
            options.startPosition = bot.entity.position.clone();
        }
        
        // Execute the build operation with rate limiting and error handling
        bot.chat(`Starting to build a ${params.structure}...`);
        
        const result = await skills.buildStructure(bot, params.structure, options);
        
        if (result) {
            return {
                success: true,
                message: `Successfully built a ${params.structure}.`
            };
        } else {
            return {
                success: false,
                message: `Failed to build a ${params.structure}. Check logs for details.`
            };
        }
    } catch (error) {
        console.error("Error in build command:", error);
        return {
            success: false,
            message: `Error while building: ${error.message}`
        };
    }
}

/**
 * Provides documentation for the build command
 * @returns {Object} Command documentation
 */
export function docs() {
    return {
        description: "Build complex structures with rate limiting to prevent disconnections",
        options: {
            structure: {
                type: "string",
                description: "Type of structure to build (tornado, spiral)",
                required: true
            },
            options: {
                type: "object",
                description: "Configuration options for the structure",
                required: false,
                properties: {
                    height: {
                        type: "number",
                        description: "Height of the structure in blocks",
                    },
                    blockTypes: {
                        type: "array",
                        description: "Array of block types to use in structure",
                    },
                    startPosition: {
                        type: "object",
                        description: "Starting position (defaults to bot position)",
                    },
                    blocksPerStep: {
                        type: "number",
                        description: "Blocks to place before pausing (lower = more stable)",
                    },
                    delayBetweenSteps: {
                        type: "number",
                        description: "Milliseconds to wait between building steps",
                    }
                }
            }
        },
        examples: [
            { 
                input: "/build tornado",
                description: "Build a tornado at the bot's current position"
            },
            {
                input: "/build spiral options:{height:20,blockTypes:['stone','glowstone']}",
                description: "Build a 20-block high spiral using stone and glowstone"
            },
            {
                input: "/build tornado options:{height:30,baseRadius:5,topRadius:10,blocksPerStep:3,delayBetweenSteps:750}",
                description: "Build a tornado with custom dimensions and extra stability (slower building)"
            }
        ]
    };
}
