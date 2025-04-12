import { ActionStateManager } from '../action_state_manager.js';
import settings from '../../../settings.js';
import pf from 'mineflayer-pathfinder';
import Vec3 from 'vec3';
import * as skills from '../library/skills.js';
import { logger } from '../../utils/logger.js';
// Map to store action state managers for each agent
const stateManagerCache = new Map();

/**
 * Get or create an action state manager for the agent
 * @param {Object} agent - The agent
 * @returns {ActionStateManager} - The action state manager
 */
function getStateManager(agent) {
    if (!stateManagerCache.has(agent.name)) {
        stateManagerCache.set(agent.name, new ActionStateManager(agent));
    }
    return stateManagerCache.get(agent.name);
}

/**
 * Create runnable action commands that handle pause/resume functionality
 */
export const actionStateCommands = [
    {
        name: '!resumeAction',
        description: 'Resume a previously paused action. Must use the EXACT SAME newAction argument provided earlier.',
        params: {
            'actionName': { type: 'string', description: 'The EXACT newAction argument from earlier. For example, if you used !newAction("build bridge"), you must use !resumeAction("build bridge").' }
        },
        perform: async function (agent, actionName) {
            const stateManager = getStateManager(agent);
            
            try {
                // Load the saved state
                const state = await stateManager.loadActionState(actionName);
                if (!state) {
                    const savedActions = await stateManager.getSavedActionNames();
                    if (savedActions.length > 0) {
                        return `No saved state found for action '${actionName}'. Available actions are: ${savedActions.join(' | ')}`;
                    } else {
                        return `No saved state found for action '${actionName}'. No saved actions available.`;
                    }
                }
                
                // Store the state in the action manager for reference
                agent.actions.savedActionState = state;
                
                if (!state.mainFn) {
                    return `Cannot resume action '${actionName}': Unable to recover the execution function. The code file may have been deleted or is not accessible.`;
                }
                try {
                    logger.debug("going to resume position...");
                    const positionVec = new Vec3(state.position.x, state.position.y, state.position.z);
                    await skills.goToPosition(agent.bot, positionVec.x, positionVec.y, positionVec.z, 0);
                    if (agent.bot.entity.position.distanceTo(positionVec) > 1) {
                        skills.log(agent.bot, `Failed to move to resume position: ${agent.bot.entity.position.distanceTo(positionVec)}`);
                        return `Failed to move to resume position: ${agent.bot.entity.position.distanceTo(positionVec)}`;
                    }
                    await agent.bot.lookAt(positionVec);
                } catch (error) {
                    console.error('Error moving to position:', error);
                    agent.bot.output += 'Error moving to position at resume start: ' + error.message + '\r\n';
                    return `Error moving to position: ${error.message}`;
                }
                
                const result = await agent.actions.runAction(state.actionName, state.mainFn, { timeout: settings.code_timeout_mins, resume: true });
                return result.message;
            } catch (error) {
                console.error('Error resuming action:', error);
                return `Error resuming action: ${error.message}`;
            }
        }
    },
    {
        name: '!cancelAction',
        description: 'Cancel a previously paused action and delete its saved state.',
        params: {
            'actionName': { type: 'string', description: 'The name of the action to cancel.' }
        },
        perform: async function (agent, actionName) {
            const stateManager = getStateManager(agent);
            
            try {
                // Check if the state exists before canceling
                const exists = await stateManager.loadActionState(actionName);
                if (!exists) {
                    const savedActions = await stateManager.getSavedActionNames();
                    if (savedActions.length > 0) {
                        skills.log(agent.bot, `No saved state found for action '${actionName}'. Available actions are: ${savedActions.join(' | ')}`);
                        return `No saved state found for action '${actionName}'. Available actions are: ${savedActions.join(' | ')}`;
                    } else {
                        skills.log(agent.bot, `No saved state found for action '${actionName}'. No saved actions available.`);
                        return `No saved state found for action '${actionName}'. No saved actions available.`;
                    }
                }
                
                // Cancel the state
                const success = await stateManager.cancelActionState(actionName);
                if (success) {
                    skills.log(agent.bot, `Canceled action state '${actionName}'.`);
                    const savedActions = await stateManager.getSavedActionNames();
                    if (savedActions.length > 0) {
                        skills.log(agent.bot, `Available actions are: ${savedActions.join(' | ')}`);
                    } else {
                        skills.log(agent.bot, `No saved actions remaining.`);
                    }
                    return `Canceled action state '${actionName}'.`;
                } else {
                    skills.log(agent.bot, `Failed to cancel action state '${actionName}'.`);
                    return `Failed to cancel action state '${actionName}'.`;
                }
            } catch (error) {
                console.error('Error canceling action state:', error);
                return `Error canceling action state: ${error.message}`;
            }
        }
    }
];

export default actionStateCommands;
