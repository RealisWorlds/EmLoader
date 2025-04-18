import { ActionStateManager } from './action_state_manager.js';
import { logger } from '../utils/logger.js';
import settings from '../../settings.js';
import Vec3 from 'vec3';
import * as skills from './library/skills.js';

export class ActionManager {
    constructor(agent) {
        this.agent = agent;
        this.executing = false;
        this.currentActionLabel = '';
        this.currentActionFn = null;
        this.timedout = false;
        this.resume_func = null;
        this.resume_name = '';
        this.savedActionState = null;
    }

    async resumeAction(actionFn, timeout) {
        return this._executeResume(actionFn, timeout);
    }

    async runAction(actionLabel, actionFn, { timeout, resume = false } = {}) {
        let doUnstuck = false;
        let doTorch = false;
        if (!this.agent.bot.modes.isOn('unstuck')) {
            doUnstuck = true;
            this.agent.bot.modes.pause('unstuck');
        }
        if (!this.agent.bot.modes.isOn('torch_placing')) {
            doTorch = true;
            this.agent.bot.modes.pause('torch_placing');
        }

        let res = null;
        if (resume) {
            res = await this._executeResume(actionLabel, actionFn, timeout);
        } else {
            res = await this._executeAction(actionLabel, actionFn, timeout);
        }

        if (doUnstuck) {
            this.agent.bot.modes.unpause('unstuck');
        }
        if (doTorch) {
            this.agent.bot.modes.unpause('torch_placing');
        }
        return res;
    }

    async stop() {
        if (!this.executing) return;
        const timeout = setTimeout(() => {
            this.agent.cleanKill(`Code execution refused stop after ${settings.execution_timeout} seconds. Killing process.`);
        }, settings.execution_timeout * 1000);
        while (this.executing) {
            this.agent.requestInterrupt();
            logger.debug('waiting for code to finish executing...');
            logger.debug(`an action is trying to interrupt current action "${this.currentActionLabel}"`);
            logger.debug(`interrupt code: ${this.agent.bot.interrupt_code}`);
            logger.debug(`executing: ${this.executing}`);
            logger.debug(`currentActionLabel: ${this.currentActionLabel}`);
            logger.debug(`currentActionFn: ${this.currentActionFn}`);
            logger.debug(`resume_func: ${this.resume_func}`);
            logger.debug(`resume_name: ${this.resume_name}`);
            logger.debug(`savedActionState: ${this.savedActionState}`);
            await new Promise(resolve => setTimeout(resolve, 300));
        }
        clearTimeout(timeout);
    } 

    cancelResume() {
        this.resume_func = null;
        this.resume_name = null;
    }

    async _executeResume(actionLabel = null, actionFn = null, timeout = 10) {
        const new_resume = actionFn != null;
        if (new_resume) { // start new resume
            this.resume_func = actionFn;
            assert(actionLabel != null, 'actionLabel is required for new resume');
            this.resume_name = actionLabel;
        }
        if (this.resume_func != null && (this.agent.isIdle() || new_resume) && (!this.agent.self_prompter.isActive() || new_resume)) {
            this.currentActionLabel = this.resume_name;
            let res = await this._executeAction(this.resume_name, this.resume_func, timeout, true);
            this.currentActionLabel = '';
            return res;
        } else {
            return { success: false, message: null, interrupted: false, timedout: false };
        }
    }

    async _executeAction(actionLabel, actionFn, timeout = 10, resume=false) {
        let TIMEOUT;
        try {
            logger.debug(`executing ${actionLabel}...`);

            // await current action to finish (executing=false), with 10 seconds timeout
            // also tell agent.bot to stop various actions
            if (this.executing) {
                logger.debug(`action "${actionLabel}" trying to interrupt current action "${this.currentActionLabel}"`);
                logger.debug(`interrupt code: ${this.agent.bot.interrupt_code}`);
                logger.debug(`executing: ${this.executing}`);
                logger.debug(`currentActionLabel: ${this.currentActionLabel}`);
                logger.debug(`currentActionFn: ${this.currentActionFn}`);
                logger.debug(`resume_func: ${this.resume_func}`);
                logger.debug(`resume_name: ${this.resume_name}`);
                logger.debug(`savedActionState: ${this.savedActionState}`);
            }
            await this.stop();

            // clear bot logs and reset interrupt code
            this.agent.clearBotLogs();

            this.executing = true;
            this.currentActionLabel = actionLabel;
            this.currentActionFn = actionFn;

            // timeout in minutes
            if (timeout > 0) {
                TIMEOUT = this._startTimeout(timeout);
            }

            // save the action for resume
            try {
                // we are only saving newActions
                if (this.currentActionLabel.startsWith('action:newAction:')) {
                    if (!this.actionStateManager) {
                        this.actionStateManager = new ActionStateManager(this.agent);
                    }
                    // only save if it doesn't already exist
                    if (!await this.actionStateManager.hasActionState(this.currentActionLabel)) {
                        logger.debug('Auto-saving ' + this.currentActionLabel);
                        const state = {
                            actionName: actionLabel || 'GenericActionLabel',
                            position: {
                                x: this.agent.bot.entity.position.x,
                                y: this.agent.bot.entity.position.y,
                                z: this.agent.bot.entity.position.z
                            },
                            // codeFilePath: this.agent.bot.codeFilePath,
                            codeFilePath: this.agent.coder.fp + this.agent.coder.file_counter + '.js',
                            actionHash: this.actionStateManager.createActionHash(actionLabel)
                        };
                        logger.debug(state);
                        await this.actionStateManager.saveActionState(actionLabel, state);
                        logger.debug('Auto-saved execution state');
                    } else {
                        logger.debug('Action state already exists for ' + this.currentActionLabel);
                    }
                }
            } catch (error) {
                console.error('Error auto-saving interrupt state:', error);
                logger.debug(error.stack);
                // throw error;
            }
            let output = null;
            // if resuming, let's move to the saved position
            try {
                
                if (resume) {
                    if (!this.actionStateManager) {
                        this.actionStateManager = new ActionStateManager(this.agent);
                    }
                    let state = await this.actionStateManager.loadActionState(actionLabel);
                    if (!state) {
                        logger.debug(`No saved state found for action '${actionLabel}'`);
                    } else {
                        // retry 3 times
                        let positionVec = null;
                        for (let i = 0; i < 3; i++) {
                            logger.debug(`Moving to saved action state position.`);
                            positionVec = new Vec3(state.position.x, state.position.y, state.position.z);
                            await skills.goToPosition(this.agent.bot, positionVec.x, positionVec.y, positionVec.z, 0);
                            await skills.wait(this.agent.bot, 500);
                            if (this.agent.bot.entity.position.distanceTo(positionVec) > 1) {
                                logger.debug(`Failed to move to resume position: ${this.agent.bot.entity.position.distanceTo(positionVec)}, try ${i + 1}`);
                                if (i == 2) {
                                    skills.log(this.agent.bot, `Failed to move to resume position: ${this.agent.bot.entity.position.distanceTo(positionVec)}`);
                                    let _message = `Failed to move to resume position: ${this.agent.bot.entity.position.distanceTo(positionVec)}`;
                                    // mark action as finished + cleanup
                                    this.executing = false;
                                    this.currentActionLabel = '';
                                    this.currentActionFn = null;
                                    clearTimeout(TIMEOUT);

                                    // get bot activity summary
                                    output = this.getBotOutputSummary();
                                    this.agent.clearBotLogs();

                                    // if not interrupted and not generating, emit idle event
                                    this.cancelResume();
                                    this.agent.bot.emit('idle');
                                    return { success: false, message: _message, interrupted: false, timedout: false };
                                }
                                skills.moveAway(this.agent.bot,5);
                                continue;
                            }
                        }
                        if (positionVec) {
                            await this.agent.bot.lookAt(positionVec);
                        }
                    }
                }
            } catch (error) {
                console.error('Error moving to position:', error);
                logger.debug('Error moving to position at resume start: ' + error.message);
                this.agent.bot.output += 'Error moving to position at resume start: ' + error.message + '\r\n';
                this.executing = false;
                return `Error moving to position: ${error.message}`;
            }
            // start the action
            //await actionFn();
            
            if (actionFn.toString().includes('(bot)') || actionFn.toString().includes('(bot,')) {
                output = await actionFn(this.agent.bot);
            } else {
                output = await actionFn();
            }
            logger.debug(`Action ${actionLabel} finished executing. Output:  ${output}`);

            // mark action as finished + cleanup
            this.executing = false;
            this.currentActionLabel = '';
            this.currentActionFn = null;
            clearTimeout(TIMEOUT);

            // get bot activity summary
            output = this.getBotOutputSummary();
            let interrupted = this.agent.bot.interrupt_code;
            let timedout = this.timedout;
            this.agent.clearBotLogs();

            // if not interrupted and not generating, emit idle event
            if (!interrupted) {
                this.cancelResume();
                this.agent.bot.emit('idle');
            }

            // return action status report
            return { success: true, message: output, interrupted, timedout };
        } catch (err) {
            this.executing = false;
            this.currentActionLabel = '';
            this.currentActionFn = null;
            clearTimeout(TIMEOUT);
            this.cancelResume();
            console.error("Code execution triggered catch:", err);
            // Log the full stack trace
            console.error(err.stack);
            await this.stop();
            err = err.toString();

            let message = this.getBotOutputSummary() +
                '!!Code threw exception!!\n' +
                'Error: ' + err + '\n' +
                'Stack trace:\n' + err.stack+'\n';

            let interrupted = this.agent.bot.interrupt_code;
            this.agent.clearBotLogs();
            if (!interrupted) {
                this.agent.bot.emit('idle');
            }
            return { success: false, message, interrupted, timedout: false };
        }
    }

    getBotOutputSummary() {
        const { bot } = this.agent;
        if (bot.interrupt_code && !this.timedout) return '';
        let output = bot.output;
        const MAX_OUT = 500;
        if (output.length > MAX_OUT) {
            output = `Action output is very long (${output.length} chars) and has been shortened.\n
          First outputs:\n${output.substring(0, MAX_OUT / 2)}\n...skipping many lines.\nFinal outputs:\n ${output.substring(output.length - MAX_OUT / 2)}`;
        }
        else {
            output = 'Action output:\n' + output.toString();
        }
        bot.output = '';
        return output;
    }

    _startTimeout(TIMEOUT_MINS = 10) {
        return setTimeout(async () => {
            console.warn(`Code execution timed out after ${TIMEOUT_MINS} minutes. Attempting force stop.`);
            this.timedout = true;
            this.agent.history.add('system', `Code execution timed out after ${TIMEOUT_MINS} minutes. Attempting force stop.`);
            await this.stop(); // last attempt to stop
        }, TIMEOUT_MINS * 60 * 1000);
    }

}