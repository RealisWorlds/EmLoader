import { writeFile, readFile, existsSync, mkdirSync, readdir, unlink, stat } from 'fs';
import { promisify } from 'util';
import { Vec3 } from 'vec3';
import path from 'path';
const { makeCompartment } = await import('./library/lockdown.js');
import * as skills from './library/skills.js';
import * as world from './library/world.js';
import { logger } from '../utils/logger.js';

// Convert callback-based fs functions to Promise-based
const writeFileAsync = promisify(writeFile);
const readFileAsync = promisify(readFile);
const readdirAsync = promisify(readdir);
const statAsync = promisify(stat);
const unlinkAsync = promisify(unlink);

/**
 * Manages action states for pausing and resuming bot actions
 */
export class ActionStateManager {
    /**
     * @param {Object} agent - The agent instance
     */
    constructor(agent) {
        this.agent = agent;
        this.stateFolderPath = path.join('./bots', agent.name, 'action-states');
        this.activeStates = {};
        
        // Ensure the directory exists
        if (!existsSync(this.stateFolderPath)) {
            mkdirSync(this.stateFolderPath, { recursive: true });
        }
    }

    /**
     * Save the current action state
     * @param {string} actionName - Name to identify this saved state
     * @returns {Promise<Object>} - The saved state
     */
    async saveActionState(actionName, pstate) {
        try {
            // Can only save state if there's a current action executing
            if (!this.agent.actions.executing) {
                logger.error('Cannot save action state: No action is executing');
                return null;
            }
    
            // Clean up actionName if needed
            if (actionName.startsWith('action:newAction:')) {
                actionName = actionName.substring('action:newAction:'.length).trim();
                logger.debug(`Using extracted prompt as action name: "${actionName}"`);
            } else {
                logger.debug(`Using action name: "${actionName}"`)
            }
            
            logger.debug(`Saving code file path: ${pstate.codeFilePath}`);
    
            // Create a safe filename from the action name
            const actionHash = this.createActionHash(actionName);
            
            // Ensure we have a valid state object
            let state = pstate || {};
            
            // Add critical fields if missing
            state.actionName = actionName;
            state.actionHash = actionHash;
            
            // Make sure we have the current code file path
            if (!state.codeFilePath && this.agent.bot.codeFilePath) {
                state.codeFilePath = this.agent.bot.codeFilePath;
            }
            
            // Save the current position if not already provided
            if (!state.position && this.agent.bot && this.agent.bot.entity) {
                state.position = {
                    x: this.agent.bot.entity.position.x,
                    y: this.agent.bot.entity.position.y,
                    z: this.agent.bot.entity.position.z
                };
            }
            
            // Save the current action function
            if (this.agent.actions.currentActionFn) {
                state.actionFn = this.agent.actions.currentActionFn;
            }
            
            // Store state in memory
            this.activeStates[actionHash] = state;
            
            // Save the code content if we have a code file path
            if (state.codeFilePath && existsSync(state.codeFilePath)) {
                try {
                    // Read the actual code content
                    const codeContent = await readFileAsync(state.codeFilePath, 'utf8');
                    state.codeContent = codeContent;
                    
                    // Also save to separate code backup file for safety
                    const codeBackupPath = path.join(this.stateFolderPath, `${actionHash}.code.js`);
                    await writeFileAsync(codeBackupPath, codeContent);
                    logger.debug(`Saved code backup to ${codeBackupPath}`);
                } catch (err) {
                    logger.error('Error reading/saving code content:', err);
                }
            }
    
            // Serialize and save to disk
            const serializedPath = this.getStatePath(actionHash);
            await this.saveStateToFile(serializedPath, state);
    
            logger.debug(`Saved action state: ${actionName} (hash: ${actionHash})`);
            return state;
        } catch (error) {
            logger.error('Error saving action state:', error);
            return null;
        }
    }

    /**
     * Cancel/remove a saved action state
     * @param {string} actionName - Name of the action to cancel
     * @returns {Promise<boolean>} - Success status
     */
    async cancelActionState(actionName) {
        try {
            // Extract action name if prefixed
            if (actionName.includes('newAction:')) {
                actionName = actionName.substring('action:newAction:'.length).trim();
                logger.debug(`Using extracted prompt as action name: "${actionName}"`);
            } else {
                logger.debug(`Using action name: "${actionName}"`);
            }
            
            // Generate hash for the action
            const actionHash = this.createActionHash(actionName);
            let actionCodePath = null;
            let actionStatePath = null;
            
            // Find matching state file
            if (existsSync(this.stateFolderPath)) {
                const files = await readdirAsync(this.stateFolderPath);
                for (const file of files) {
                    if (file.endsWith('.json')) {
                        const statePath = path.join(this.stateFolderPath, file);
                        try {
                            const stateData = JSON.parse(await readFileAsync(statePath, 'utf8'));
                            if (stateData.actionHash === actionHash) {
                                actionCodePath = stateData.codeFilePath;
                                if (actionCodePath?.startsWith('\\')) {
                                    actionCodePath = actionCodePath.slice(1);
                                }
                                actionStatePath = statePath;
                                break;
                            }
                        } catch (err) {
                            logger.error(`Error parsing state file ${file}:`, err);
                        }
                    }
                }
            }
    
            if (!actionCodePath) {
                logger.error(`Could not find disk-saved action with name: ${actionName}`);
            }
    
            logger.debug('Found action details:', {
                actionName,
                actionHash,
                actionStatePath,
                actionCodePath
            });
    
            // Delete code file if exists
            if (actionCodePath && existsSync(actionCodePath)) {
                try {
                    await new Promise((resolve, reject) => {
                        unlink(actionCodePath, (err) => err ? reject(err) : resolve());
                    });
                    logger.debug(`Removed code file: ${actionCodePath}`);
                } catch (err) {
                    logger.error(`Error removing code file: ${err}`);
                }
            }
            
            // Delete state file if exists
            if (actionStatePath && existsSync(actionStatePath)) {
                try {
                    await new Promise((resolve, reject) => {
                        unlink(actionStatePath, (err) => err ? reject(err) : resolve());
                    });
                    logger.debug(`Removed state file: ${actionStatePath}`);
                } catch (err) {
                    logger.error(`Error removing state file: ${err}`);
                }
            }
            
            // Remove from memory
            if (this.activeStates[actionHash]) {
                logger.debug(`Found in memory by hash: ${actionHash}`);
                delete this.activeStates[actionHash];
            } else {
                logger.debug(`Not found in memory by hash: ${actionHash}`);
            }
    
            // Verify cleanup was successful
            const filesStillExist = [
                actionCodePath && existsSync(actionCodePath),
                actionStatePath && existsSync(actionStatePath),
                this.activeStates[actionHash]
            ].some(Boolean);
            
            if (filesStillExist) {
                logger.error('Some files still exist after attempted removal:', {
                    codeFileExists: actionCodePath && existsSync(actionCodePath),
                    stateFileExists: actionStatePath && existsSync(actionStatePath),
                    memoryStateExists: !!this.activeStates[actionHash]
                });
                return false;
            }
            
            logger.debug(`Successfully removed action state for ${actionName}`);
            return true;
        } catch (error) {
            logger.error(`Error canceling action state for ${actionName}:`, error);
            return false;
        }
    }

    /**
     * Check if a saved state exists for an action
     * @param {string} actionName - Name of the action to check
     * @returns {Promise<boolean>} - Whether the state exists
     */
    async hasActionState(actionName) {
        if (!actionName) return false;
        
        const actionHash = this.createActionHash(actionName);
        
        // Check memory first
        if (this.activeStates[actionHash]) return true;
        
        // Then check disk
        const statePath = this.getStatePath(actionHash);
        return existsSync(statePath);
    }

    /**
     * Get all saved action states
     * @returns {Promise<Object>} - Object with action names as keys and state objects as values
     */
    async getAllActionStates() {
        try {
            const states = { ...this.activeStates };
            
            // Also check for saved states on disk
            if (existsSync(this.stateFolderPath)) {
                const files = await readdirAsync(this.stateFolderPath);
                for (const file of files) {
                    if (file.endsWith('.json')) {
                        const statePath = path.join(this.stateFolderPath, file);
                        const stateData = await readFileAsync(statePath, 'utf8');
                        const state = JSON.parse(stateData);
                        const actionHash = state.actionHash;
                        if (!states[actionHash]) {
                            states[actionHash] = state;
                        }
                    }
                }
            }
            
            return states;
        } catch (error) {
            logger.error("Error getting all action states:", error);
            return {};
        }
    }

    /**
     * Load a saved action state
     * @param {string} actionName - Name of the action to load
     * @returns {Promise<Object|null>} - The loaded state or null if not found
     */
    async loadActionState(actionName) {
        try {
            // if actionName has newAction in it, remove that from it
            if (actionName.startsWith('action:newAction:')) {
                actionName = actionName.substring('action:newAction:'.length).trim();
                logger.debug(`Using extracted prompt as action name: "${actionName}"`);
            } else {
                logger.debug(`Using action name: "${actionName}"`)
            }
            const actionHash = this.createActionHash(actionName);
            
            // First try memory
            let state = this.activeStates[actionHash];
            
            // Then try disk by hash
            if (!state) {
                const statePath = this.getStatePath(actionHash);
                if (existsSync(statePath)) {
                    const stateData = await readFileAsync(statePath, 'utf8');
                    state = JSON.parse(stateData);
                    this.activeStates[actionHash] = state;
                    logger.debug(`Loaded action state from disk: ${actionName} (hash: ${actionHash})`);
                }
            }

            // If we still don't have a state, try to find by name
            if (!state) {
                const states = await this.getAllActionStates();
                const matchingState = Object.values(states).find(s => 
                    s.actionName.toLowerCase() === actionName.toLowerCase()
                );
                if (matchingState) {
                    logger.debug(`Found matching action state by name: ${actionName}`);
                    state = matchingState;
                    // Update the hash-based lookup in memory
                    const hash = this.createActionHash(matchingState.actionName);
                    this.activeStates[hash] = state;
                }
            }

            if (!state) {
                logger.warn(`No saved state found for action: ${actionName}`);
                return null;
            }
            logger.debug('Loaded action state:', state)
            // If we have a code file path, try to recreate the resume function
            if (state.codeFilePath) {
                try {
                    // Extract just the filename from the path
                    const filename = path.basename(state.codeFilePath);
                    logger.debug(`Extracted filename: ${filename}`);
                    
                    // Construct the path to the action-code directory
                    const actionCodeDir = path.join(this.stateFolderPath, '..', 'action-code');
                    logger.debug(`Action code directory: ${actionCodeDir}`);
                    
                    // Join the directory with the filename
                    const codeFilePath = path.join(actionCodeDir, filename);
                    logger.debug(`Full code file path: ${codeFilePath}`);
                    
                    if (!existsSync(codeFilePath)) {
                        logger.error(`Code file not found at path: ${codeFilePath}`);
                        return null;
                    }
                    
                    // Read the code file
                    const codeData = await readFileAsync(codeFilePath, 'utf8');
                    
                    const compartment = makeCompartment({
                        skills,
                        log: skills.log,
                        world,
                        Vec3
                    });
                    // Evaluate the code in the compartment
                    const mainFn = await compartment.evaluate(codeData);
                    logger.debug('Evaluated mainFn:', mainFn);
                    logger.debug('mainFn properties:', Object.keys(mainFn));
                    
                    // Match the structure used in coder.js
                    // In coder.js, the function is wrapped in a { func: { main: mainFn } } structure
                    if (typeof mainFn === 'function') {
                        // Create the same structure as coder.js uses
                        state.mainFn = mainFn;
                        logger.debug('Using mainFn directly as the resume function');
                    } else if (mainFn && typeof mainFn.main === 'function') {
                        // Handle the case where it already has a main property
                        state.mainFn = mainFn.main;
                        logger.debug('Using mainFn.main as the resume function');
                    } else {
                        logger.error('No valid function found in the evaluated code');
                        return null;
                    }
                    
                    logger.debug('Successfully recreated resume function from code file.');
                    
                    // Log function details
                    logger.debug('Resume function type:', typeof state.mainFn);
                    logger.debug('Resume function available:', state.mainFn !== null && state.mainFn !== undefined);
                    if (typeof state.mainFn === 'function') {
                        logger.debug('Resume function is a valid function');
                    } else {
                        logger.debug('Resume function is not a valid function:', state.mainFn);
                    }
                } catch (error) {
                    logger.error('Error recreating resume function:', error);
                    return null;
                }
            }
            
            return state;
        } catch (error) {
            logger.error('Error loading action state:', error);
            return null;
        }
    }

    /**
     * Get the names of saved actions
     * @returns {Promise<string[]>} - Array of saved action names
     */
    async getSavedActionNames() {
        try {
            const states = await this.getAllActionStates();
            if (Object.keys(states).length > 0) {
                return Object.keys(states).map(actionHash => states[actionHash].actionName);
            }
            return [];
        } catch (error) {
            logger.error('Error getting saved action names:', error);
            return [];
        }
    }

    /**
     * Create a unique hash for an action name
     * @param {string} actionName - The action name to hash
     * @returns {string} - A unique hash for the action
     */
    createActionHash(actionName) {
        // Use a simple hash function that's fast and produces a consistent length
        // if actionName has newAction: in it, remove that from it
        if (actionName.startsWith('action:newAction:')) {
            actionName = actionName.substring('action:newAction:'.length).trim();
            logger.debug(`Using extracted prompt as action name: "${actionName}"`);
        } else {
            logger.debug(`Using action name: "${actionName}"`)
        }
        let hash = 0;
        // Iterate through the action name multiple times to increase hash length
        for (let k = 0; k < 3; k++) {  // Repeat 3 times
            for (let i = 0; i < actionName.length; i++) {
                hash = (hash * 31 + actionName.charCodeAt(i)) | 0;
            }
        }
        return `action_${Math.abs(hash)}`;
    }

    /**
     * Get the path for a state file
     * @private
     * @param {string} actionHash - The hash of the action
     * @returns {string} - Path to the state file
     */
    getStatePath(actionHash) {
        return path.join(this.stateFolderPath, `${actionHash}.json`);
    }

    /**
     * Save state to a file
     * @private
     * @param {string} filePath - Path to the file
     * @param {Object} state - State to save
     * @returns {Promise<void>}
     */
    async saveStateToFile(filePath, state) {
        // overwrite it if it exists anyways
        try {
            await writeFileAsync(filePath, JSON.stringify(state, null, 2));
        } catch (error) {
            logger.error('Error saving state to file:', error);
        }
        // delete files in that directory which are older than 48 hours
        const now = Date.now();
        const files = await readdirAsync(this.stateFolderPath);
        for (const file of files) {
            const filePath = path.join(this.stateFolderPath, file);
            const stats = await statAsync(filePath);
            // delete files that are older than 48 hours
            if (now - stats.mtime.getTime() > 48 * 60 * 60 * 1000) {
                await unlinkAsync(filePath);
            }
        }
    }

}
