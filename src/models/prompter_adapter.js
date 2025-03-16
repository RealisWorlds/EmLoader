/**
 * PrompterAdapter - Adapter to migrate from original Prompter to EnhancedPrompter
 * 
 * This file allows for a smooth transition between the old Prompter implementation
 * and the new EnhancedPrompter with improved reliability and performance.
 */

import { EnhancedPrompter } from './enhanced_prompter.js';

/**
 * Creates a new instance of the EnhancedPrompter while maintaining
 * backward compatibility with the original Prompter API
 * 
 * @param {Object} agent - The agent instance
 * @param {string} profilePath - Path to the agent profile
 * @param {Object} memory - Optional memory instance
 * @returns {EnhancedPrompter} Enhanced prompter instance
 */
export function createPrompter(agent, profilePath, memory = null) {
    // Create the enhanced prompter
    const enhancedPrompter = new EnhancedPrompter(agent, profilePath, memory);
    
    // Expose original API methods that might be called directly
    return enhancedPrompter;
}

/**
 * Drop-in replacement for the original Prompter
 * Use this class when you need to maintain exact compatibility with the old API
 */
export class Prompter extends EnhancedPrompter {
    constructor(agent, fp, memory) {
        super(agent, fp, memory);
        console.log('Using enhanced prompter implementation with improved reliability');
    }
}
