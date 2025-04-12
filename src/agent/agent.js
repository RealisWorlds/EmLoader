import { History } from './history.js';
import { Coder } from './coder.js';
import { VisionInterpreter } from './vision/vision_interpreter.js';
import { Prompter } from '../models/prompter.js';
import { initModes } from './modes.js';
import { initBot } from '../utils/mcdata.js';
import { containsCommand, commandExists, executeCommand, truncCommandMessage, isAction, blacklistCommands } from './commands/index.js';
import { ActionManager } from './action_manager.js';
import { NPCContoller } from './npc/controller.js';
import { MemoryBank } from './memory_bank.js';
import { SelfPrompter } from './self_prompter.js';
import convoManager from './conversation.js';
import { handleTranslation, handleEnglishTranslation } from '../utils/translator.js';
import { addBrowserViewer } from './vision/browser_viewer.js';
import settings from '../../settings.js';
import { serverProxy } from './agent_proxy.js';
import { Task } from './tasks.js';
import { say } from './speak.js';
import { logger } from '../utils/logger.js';
import { spawn } from 'child_process';

export class Agent {
    async start(profile_fp, load_mem=false, init_message=null, count_id=0, task_path=null, task_id=null) {
        this.last_sender = null;
        this.count_id = count_id;
        if (!profile_fp) {
            throw new Error('No profile filepath provided');
        }
        
        logger.debug('Starting agent initialization with profile:', profile_fp);
        
        // Initialize components with more detailed error handling
        logger.debug('Initializing action manager...');
        this.actions = new ActionManager(this);
        logger.debug('Initializing prompter...');
        this.prompter = new Prompter(this, profile_fp);
        this.name = this.prompter.getName();
        logger.debug('Initializing history...');
        this.history = new History(this);
        logger.debug('Initializing coder...');
        this.coder = new Coder(this);
        logger.debug('Initializing npc controller...');
        this.npc = new NPCContoller(this);
        logger.debug('Initializing memory bank...');
        this.memory_bank = new MemoryBank();
        logger.debug('Initializing self prompter...');
        this.self_prompter = new SelfPrompter(this);
        convoManager.initAgent(this);            
        logger.debug('Initializing examples...');
        await this.prompter.initExamples();
        logger.debug('Initializing task...');
        this.task = new Task(this, task_path, task_id);
        const blocked_actions = settings.blocked_actions.concat(this.task.blocked_actions || []);
        blacklistCommands(blocked_actions);

        serverProxy.connect(this);

        logger.debug(this.name, 'logging into minecraft...');
        this.bot = initBot(this.name);

        initModes(this);

        let save_data = null;
        if (load_mem) {
            save_data = this.history.load();
        }

        this.bot.on('login', () => {
            logger.debug(this.name, 'logged in!');

            serverProxy.login();
            
            // Set skin for profile, requires Fabric Tailor. (https://modrinth.com/mod/fabrictailor)
            if (this.prompter.profile.skin)
                this.bot.chat(`/skin set URL ${this.prompter.profile.skin.model} ${this.prompter.profile.skin.path}`);
            else
                this.bot.chat(`/skin clear`);
        });

        const spawnTimeout = setTimeout(() => {
            process.exit(0);
        }, 30000);
        this.bot.once('spawn', async () => {
            try {
                clearTimeout(spawnTimeout);
                addBrowserViewer(this.bot, count_id);

                // wait for a bit so stats are not undefined
                await new Promise((resolve) => setTimeout(resolve, 1000));
                
                logger.debug(`${this.name} spawned.`);
                this.clearBotLogs();

                this._setupEventHandlers(save_data, init_message);
                this.startEvents();

                if (!load_mem) {
                    this.task.initBotTask();
                }

                logger.debug('Initializing vision intepreter...');
                this.vision_interpreter = new VisionInterpreter(this, settings.allow_vision);

            } catch (error) {
                console.error('Error in spawn event:', error);
                process.exit(0);
            }
        });
    }

    async _setupEventHandlers(save_data, init_message) {
        const ignore_messages = [
            "Set own game mode to",
            "Set the time to",
            "Set the difficulty to",
            "Teleported ",
            "Set the weather to",
            "Gamerule "
        ];
        
        const respondFunc = async (username, message) => {
            if (username === this.name) return;
            if (settings.only_chat_with.length > 0 && !settings.only_chat_with.includes(username)) return;
            try {
                if (ignore_messages.some((m) => message.startsWith(m))) return;

                this.shut_up = false;

                logger.debug(this.name, 'received message from', username, ':', message);
                
                // // Process normally
                let translation = await handleEnglishTranslation(message);
                this.handleMessage(username, translation);
            } catch (error) {
                console.error('Error handling message:', error);
            }
        }
		
		this.respondFunc = respondFunc

        this.bot.on('whisper', respondFunc);
        if (settings.profiles.length === 1)
            this.bot.on('chat', respondFunc);

        // Set up auto-eat
        this.bot.autoEat.options = {
            priority: 'foodPoints',
            startAt: 14,
            bannedFood: ["rotten_flesh", "spider_eye", "poisonous_potato", "pufferfish", "chicken"]
        };

        if (save_data?.self_prompt) {
            if (init_message) {
                this.history.add('system', init_message);
            }
            await this.self_prompter.handleLoad(save_data.self_prompt, save_data.self_prompting_state);
        }
        if (save_data?.last_sender) {
            this.last_sender = save_data.last_sender;
        }
        else if (init_message) {
            await this.handleMessage('system', init_message, 2, true);
        }
        else {
            this.openChat("Hello world! I am "+this.name);
        }
    }

    requestInterrupt() {
		try {
	        this.bot.interrupt_code = true;
	        this.bot.stopDigging();
	        this.bot.collectBlock.cancelTask();
	        this.bot.pathfinder.stop();
	        this.bot.pvp.stop();
        } catch (error) {
            console.error('Error requesting interrupt:', error);
        }
    }

    clearBotLogs() {
        this.bot.output = '';
        this.bot.interrupt_code = false;
    }

    shutUp() {
        this.shut_up = true;
        if (this.self_prompter.isActive()) {
            this.self_prompter.stop(false);
        }
    }

    _pendingUserMessages = false;
    _userMessageTimeout = null;

    _mutex = Promise.resolve(); // Initially unlocked

    // Helper method to ensure atomic operations on critical variables
    async _withLock(operation) {
        // Create a new mutex that resolves when operation completes
        const unlock = await this._mutex.then(() => {
            // Return a function that will resolve the next waiting operation
            let unlockNext;
            const unlockPromise = new Promise(resolve => {
                unlockNext = resolve;
            });
            
            // Set the new mutex to this operation's unlock promise
            this._mutex = unlockPromise;
            
            // Return the unlock function
            return unlockNext;
        });
        
        try {
            // Execute the critical operation
            return await operation();
        } finally {
            // Release the lock regardless of success/failure
            unlock();
        }
    }

    // batch with priority and immediate processing
    async handleMessage(source, message, max_responses=null, awaitResponse=false) {
        try {
            if (!source || !message) {
                console.warn('Received empty message from', source);
                return false;
            }
            // Really don't like seeing this message spammed, wasting API calls on other bots
            if (message === 'My brain disconnected, try again.') {
                console.warn(`${source}: My brain disconnected, try again.`);
                return false;
            }
            logger.debug(`${source}: ${message}`);
            const needsImmediateProcessing = (
                source === 'system' || 
                awaitResponse || 
                !this.prompter.generatingPrompt
            );
            logger.debug('Needs immediate processing:', needsImmediateProcessing);
            // If we need immediate processing and generation is already happening,
            // wait for it to finish first
            logger.debug('Checking for existing generation...');
            if (needsImmediateProcessing && this.prompter.generatingPrompt) {
                logger.debug(`Waiting for existing generation to complete before processing ${source} message`);
                await new Promise(resolve => {
                    const checkInterval = setInterval(() => {
                        if (!this.prompter.generatingPrompt) {
                            clearInterval(checkInterval);
                            resolve();
                        }
                    }, 1000);
                });
            }
            logger.debug('Checked for existing generation');
            // For immediate processing, process now
            logger.debug('Checking for immediate processing...');
            if (needsImmediateProcessing) {
                logger.debug('Processing immediate message...');
                return await this._processMessage(source, message, max_responses);
            }
            logger.debug('Checked for immediate processing');
            // For batch processing, add to batch
            logger.debug('Checking for batch processing...');
            return await this._withLock(async () => {
                // Check if already batching
                if (this._pendingUserMessages && awaitResponse === false) {
                    logger.debug('Already batching, skipping message...');
                    return true;
                }
                
                // For regular user messages during generation, flag for later batch processing
                logger.debug(`Batching message from ${source} for later processing`);
                
                this._pendingUserMessages = true;
                
                // Schedule batch processing if not already scheduled
                if (!this._userMessageTimeout) {
                    this._userMessageTimeout = setTimeout(async () => {
                        try {
                            // Lock again when the timer fires to safely reset state
                            await this._withLock(async () => {
                                this._userMessageTimeout = null;
                                
                                if (this._pendingUserMessages && !this.prompter.generatingPrompt) {
                                    logger.debug('Processing batched user messages');
                                    
                                    // Reset flag BEFORE processing to prevent race conditions
                                    this._pendingUserMessages = false;
                                    
                                    // Process outside the lock to allow new batches to form
                                    setTimeout(() => {
                                        this._processMessage(source, message, 1)
                                            .catch(err => {
                                                console.error('Error processing batch:', err);
                                                // Reset pending flag in case of error to unblock the system
                                                this._pendingUserMessages = false;
                                                this._retryCount = 0;
                                            });
                                    }, 0);
                                } else {
                                    logger.debug('Skipping due to gen in progress: ', this._pendingUserMessages, this.prompter.generatingPrompt);
                                    // Set up retry with counter
                                    const retryCount = this._retryCount || 0;
                                    if (retryCount < 5) {
                                        setTimeout(() => {
                                            this._userMessageTimeout = null;
                                            this._retryCount = retryCount + 1;
                                            logger.debug(`Retry attempt ${retryCount + 1}/5 for batched message`);
                                            this.handleMessage(source, message, 1, false)
                                                .catch(err => {
                                                    console.error('Error in retry attempt:', err);
                                                    // Reset pending flag in case of error to unblock the system
                                                    this._pendingUserMessages = false;
                                                    this._retryCount = 0;
                                                });
                                        }, 500);
                                    } else {
                                        logger.debug('Max retries reached, giving up on batched message');
                                        this._pendingUserMessages = false;
                                        this._retryCount = 0;
                                    }
                                }
                            }).catch(err => {
                                console.error('Lock acquisition error in timeout:', err);
                                // Ensure we reset state in case of error with the lock itself
                                this._pendingUserMessages = false;
                                this._userMessageTimeout = null;
                                this._retryCount = 0;
                            });
                        } catch (outerError) {
                            // Catch any errors that might occur outside the lock
                            console.error('Fatal error in batch processing timeout:', outerError);
                            // Reset all state to ensure system doesn't get stuck
                            this._pendingUserMessages = false;
                            this._userMessageTimeout = null;
                            this._retryCount = 0;
                        }
                    }, 1000);
                }
                // Non-awaited calls just return true
                logger.debug('Non-awaited return')
                return true;
            });
        } catch (error) {
            console.error('Error in handleMessage:', error);
            this._pendingUserMessages = false;
            return false;
        }
    }

    // // batch everything no prioritizing or immediate processing.
    // async handleMessage(source, message, max_responses=null, awaitResponse=false) {
    //     try {
    //         if (!source || !message) {
    //             console.warn('Received empty message from', source);
    //             return false;
    //         }
    //         // Really don't like seeing this message spammed, wasting API calls on other bots
    //         if (message === 'My brain disconnected, try again.') {
    //             console.warn(`${source}: My brain disconnected, try again.`);
    //             return false;
    //         }
    //         logger.debug(`${source}: ${message}`);
            
    //         // Simplified logic: if not generating, process immediately; otherwise batch
    //         if (!this.prompter.generatingPrompt) {
    //             logger.debug('No generation in progress, processing immediately...');
    //             return await this._processMessage(source, message, max_responses);
    //         }
            
    //         // If generation is in progress, batch the message
    //         logger.debug('Generation in progress, checking for batch processing...');
    //         return await this._withLock(async () => {
    //             // Check if already batching
    //             if (this._pendingUserMessages) {
    //                 logger.debug('Already batching, skipping message...');
    //                 return true;
    //             }
                
    //             // Flag for batch processing
    //             logger.debug(`Batching message from ${source} for later processing`);
    //             this._pendingUserMessages = true;
                
    //             // Schedule batch processing if not already scheduled
    //             if (!this._userMessageTimeout) {
    //                 this._userMessageTimeout = setTimeout(async () => {
    //                     try {
    //                         // Lock again when the timer fires to safely reset state
    //                         await this._withLock(async () => {
    //                             this._userMessageTimeout = null;
                                
    //                             if (this._pendingUserMessages && !this.prompter.generatingPrompt) {
    //                                 logger.debug('Processing batched user messages');
                                    
    //                                 // Reset flag BEFORE processing to prevent race conditions
    //                                 this._pendingUserMessages = false;
                                    
    //                                 // Process outside the lock to allow new batches to form
    //                                 setTimeout(() => {
    //                                     this._processMessage(source, message, 1)
    //                                         .catch(err => {
    //                                             console.error('Error processing batch:', err);
    //                                             // Reset pending flag in case of error to unblock the system
    //                                             this._pendingUserMessages = false;
    //                                             this._retryCount = 0;
    //                                         });
    //                                 }, 0);
    //                             } else {
    //                                 logger.debug('Skipping due to gen in progress: ', this._pendingUserMessages, this.prompter.generatingPrompt);
    //                                 // Set up retry with counter
    //                                 const retryCount = this._retryCount || 0;
    //                                 if (retryCount < 5) {
    //                                     setTimeout(() => {
    //                                         this._userMessageTimeout = null;
    //                                         this._retryCount = retryCount + 1;
    //                                         logger.debug(`Retry attempt ${retryCount + 1}/5 for batched message`);
    //                                         this.handleMessage(source, message, 1, false)
    //                                             .catch(err => {
    //                                                 console.error('Error in retry attempt:', err);
    //                                                 // Reset pending flag in case of error to unblock the system
    //                                                 this._pendingUserMessages = false;
    //                                                 this._retryCount = 0;
    //                                             });
    //                                     }, 500);
    //                                 } else {
    //                                     logger.debug('Max retries reached, giving up on batched message');
    //                                     this._pendingUserMessages = false;
    //                                     this._retryCount = 0;
    //                                 }
    //                             }
    //                         }).catch(err => {
    //                             console.error('Lock acquisition error in timeout:', err);
    //                             // Ensure we reset state in case of error with the lock itself
    //                             this._pendingUserMessages = false;
    //                             this._userMessageTimeout = null;
    //                             this._retryCount = 0;
    //                         });
    //                     } catch (outerError) {
    //                         // Catch any errors that might occur outside the lock
    //                         console.error('Fatal error in batch processing timeout:', outerError);
    //                         // Reset all state to ensure system doesn't get stuck
    //                         this._pendingUserMessages = false;
    //                         this._userMessageTimeout = null;
    //                         this._retryCount = 0;
    //                     }
    //                 }, 1000);
    //             }
    //             // Non-awaited calls just return true
    //             logger.debug('Non-awaited return')
    //             return true;
    //         });
    //     } catch (error) {
    //         console.error('Error in handleMessage:', error);
    //         this._pendingUserMessages = false;
    //         return false;
    //     }
    // }

    async _processMessage(source, message, max_responses) {
    	try {
	        if (!source || !message) {
	            console.warn('Received empty message from', source);
                return false;
            }
			logger.debug(`${source}: ${message}`);
        	let used_command = false;
        	if (max_responses === null) {
            	max_responses = settings.max_commands === -1 ? Infinity : settings.max_commands;
        	}
	        if (max_responses === -1) {
	            max_responses = Infinity;
			}

	        const self_prompt = source === 'system' || source === this.name;
	        const from_other_bot = convoManager.isOtherAgent(source);

	        if (from_other_bot)
	            this.last_sender = source;

            // Now translate the message
            message = await handleEnglishTranslation(message);
            logger.debug('received message from', source, ':', message);

            const checkInterrupt = () => this.self_prompter.shouldInterrupt(self_prompt) || this.shut_up;
            
            let behavior_log = this.bot.modes.flushBehaviorLog();
            if (behavior_log.trim().length > 0) {
                const MAX_LOG = 500;
                if (behavior_log.length > MAX_LOG) {
                    behavior_log = '...' + behavior_log.substring(behavior_log.length - MAX_LOG);
                }
                behavior_log = 'Recent behaviors log: \n' + behavior_log.substring(behavior_log.indexOf('\n'));
                await this.history.add('system', behavior_log);
            }
            logger.debug('Saving History');
            // handle other user messages
            await this.history.add(source, message);
            await this.history.save();
            logger.debug('Saved History');
            let res = '';
            if (!self_prompt && this.self_prompter.isActive()) // message is from user during self-prompting
                max_responses = 1; // force only respond to this message, then let self-prompting take over
            logger.debug('Starting Prompting');
            for (let i=0; i<max_responses; i++) {
                if (checkInterrupt()) break;
                logger.debug('Prompting');
                let history = this.history.getHistory();
                logger.debug('Got History');
                try {
                    logger.debug('Prompting');
                    res = await this.prompter.promptConvo(history);
                    logger.debug('Got Response');
                } catch (error) {
                    console.error('Error getting response:', error.substring(0, 100));
                    continue; // try again
                }

                logger.debug(`${this.name} full response to ${source}: ""${res}""`);
                
                if (res.trim().length === 0) { 
                    console.warn('no response')
                    break; // empty response ends loop
                }
                
                // Check for !ignore
                if (res.includes('!ignore')) {
                    logger.debug(`Ignoring message from ${source} based on AI directive: ${res}`);
                    break; // Skip processing this response entirely
                }

                let command_name = containsCommand(res);

                if (command_name) { // contains query or command
                    logger.debug('contains command', command_name, 'from res:', res);
                    res = truncCommandMessage(res); // everything after the command is ignored
                    await this.history.add(this.name, res);
                    
                    if (!commandExists(command_name)) {
                        await this.history.add('system', `Command ${command_name} does not exist.`);
                        console.warn('Agent hallucinated command:', command_name)
                        continue;
                    }

                    if (checkInterrupt()) break;
                    this.self_prompter.handleUserPromptedCmd(self_prompt, isAction(command_name));

                    if (settings.verbose_commands) {
                        await this.routeResponse(source, res);
                    }
                    else { // only output command name
                        let pre_message = res.substring(0, res.indexOf(command_name)).trim();
                        let chat_message = `*used ${command_name.substring(1)}*`;
                        if (pre_message.length > 0)
                            chat_message = `${pre_message}`; //  ${chat_message}`;
                        this.routeResponse(source, chat_message);
                    }

                    let execute_res = await executeCommand(this, res);
                    if (!execute_res) {
                        execute_res = `Command ${command_name} execution was stopped.`;
                    }

                    logger.debug('Agent executed:', command_name, 'and got:', execute_res);
                    used_command = true;

                    if (execute_res) {
                        await this.history.add('system', execute_res);
                        
                        // // Store important command results as memories
                        // if (this.prompter && this.prompter.vectorClient && 
                        //     ['!craftItem', '!build', '!collectBlocks', '!attack'].some(cmd => command_name.startsWith(cmd))) {
                        //     const commandMemory = `${this.name} used ${command_name} with result: ${execute_res}`;
                        //     await this.prompter.promptMemoryStorage(commandMemory, "high").catch(err => {
                        //         console.warn('Failed to store command memory:', err);
                        //     });
                        // }
                    }
                    else
                        break;
                }
                else { // conversation response
                    await this.routeResponse(source, res);
                    await this.history.add(this.name, res);
                    // // Store the agent's own responses as memories if they seem important
                    // if (this.prompter && this.prompter.vectorClient && 
                    //     (res.includes('important') || res.includes('remember') || res.includes('learned'))) {
                    //     const responseMemory = `${this.name} told ${source}: ${res}`;
                    //     await this.prompter.promptMemoryStorage(responseMemory, "medium").catch(err => {
                    //         console.warn('Failed to store response memory:', err);
                    //     });
                    // }
                    
                    break;
                }
                
                await this.history.save();
            }

            return used_command;
        } catch (error) {
            console.error('Error in _processMessage:', error.message || error);
            return false;
        }
    }

    async routeResponse(to_player, message) {
        if (this.shut_up) return;
        let self_prompt = to_player === 'system' || to_player === this.name;
        if (self_prompt && this.last_sender) {
            to_player = this.last_sender;
        }

        // otherwise, use open chat
        if (!message.startsWith('SYSTEM:') && !message.startsWith('Code output:')) {
            this.openChat(message);
        }
        // note that to_player could be another bot, but if we get here the conversation has ended
    }

    async openChat(message) {
        let to_translate = message;
        let remaining = '';
        let command_name = containsCommand(message);
        let translate_up_to = command_name ? message.indexOf(command_name) : -1;
        if (translate_up_to != -1) { // don't translate the command
            to_translate = to_translate.substring(0, translate_up_to);
            remaining = message.substring(translate_up_to);
        }
        message = (await handleTranslation(to_translate)).trim() + " " + remaining;
        // newlines are interpreted as separate chats, which triggers spam filters. replace them with spaces
        message = message.replaceAll('\n', ' ');

        if (settings.only_chat_with.length > 0) {
            for (let username of settings.only_chat_with) {
                this.bot.whisper(username, message);
            }
        }
        else {
	    if (settings.speak) {
            say(to_translate);
	    }
            this.bot.chat(message);
        }
    }

    startEvents() {
        // Custom events
        this.bot.on('time', () => {
            if (this.bot.time.timeOfDay == 0)
            this.bot.emit('sunrise');
            else if (this.bot.time.timeOfDay == 6000)
            this.bot.emit('noon');
            else if (this.bot.time.timeOfDay == 12000)
            this.bot.emit('sunset');
            else if (this.bot.time.timeOfDay == 18000)
            this.bot.emit('midnight');
        });

        let prev_health = this.bot.health;
        this.bot.lastDamageTime = 0;
        this.bot.lastDamageTaken = 0;
        this.bot.on('health', () => {
            if (this.bot.health < prev_health) {
                this.bot.lastDamageTime = Date.now();
                this.bot.lastDamageTaken = prev_health - this.bot.health;
            }
            prev_health = this.bot.health;
        });
        // Logging callbacks
        this.bot.on('error' , (err) => {
            console.error('Error event!', err);
        });
        this.bot.on('end', (reason) => {
            console.warn('Bot disconnected! Killing agent process.', reason)
            this.cleanKill('Bot disconnected! Killing agent process.');
        });
        this.bot.on('death', () => {
            this.actions.cancelResume();
            this.actions.stop();
        });
        this.bot.on('kicked', (reason) => {
            console.warn('Bot kicked!', reason);
            this.cleanKill('Bot kicked! Killing agent process.');
        });
        this.bot.on('messagestr', async (message, _, jsonMsg) => {
            if (jsonMsg.translate && jsonMsg.translate.startsWith('death') && message.startsWith(this.name)) {
                logger.debug('Agent died: ', message);
                let death_pos = this.bot.entity.position;
                this.memory_bank.rememberPlace('last_death_position', death_pos.x, death_pos.y, death_pos.z);
                let death_pos_text = null;
                if (death_pos) {
                    death_pos_text = `x: ${death_pos.x.toFixed(2)}, y: ${death_pos.y.toFixed(2)}, z: ${death_pos.x.toFixed(2)}`;
                }
                let dimention = this.bot.game.dimension;
                this.handleMessage('system', `You died at position ${death_pos_text || "unknown"} in the ${dimention} dimension with the final message: '${message}'. Your place of death is saved as 'last_death_position' if you want to return. Previous actions were stopped and you have respawned.`);
            }
        });
        this.bot.on('idle', () => {
			try {
				this.bot.clearControlStates();
                this.bot.pathfinder.stop(); // clear any lingering pathfinder
                this.bot.modes.unPauseAll();
                if (this.actions.resume_func) {
                    this.actions.resumeAction();
                }
            } catch (error) {
                console.error('Error in idle event:', error);
            }
        });

        // Init NPC controller
        this.npc.init();

        // This update loop ensures that each update() is called one at a time, even if it takes longer than the interval
        const INTERVAL = 300;
        let last = Date.now();
        setTimeout(async () => {
            while (true) {
                let start = Date.now();
                await this.update(start - last);
                let remaining = INTERVAL - (Date.now() - start);
                if (remaining > 0) {
                    await new Promise((resolve) => setTimeout(resolve, remaining));
                }
                last = start;
            }
        }, INTERVAL);

        this.bot.emit('idle');
    }

    async update(delta) {
        if (this.prompter) {
          this.cooldown = 2000;
        }
        await this.bot.modes.update();
        this.self_prompter.update(delta);
        if (this.task.data) {
            let res = this.task.isDone();
            if (res) {
                await this.history.add('system', `${res.message} ended with code : ${res.code}`);
                await this.history.save();
                logger.debug('Task finished:', res.message);
                this.killAll();
            }
        }
    }

    isIdle() {
        return !this.actions.executing && !this.coder.generating;
    }
    
    // cleanKill(msg='Killing agent process...', code=1) {
    //     this.history.add('system', msg);
    //     this.bot.chat(code > 1 ? 'Restarting.': 'Exiting.');
    //     this.history.save();
    //     process.exit(code);
    // }

    cleanKill(msg='Killing agent process...', code=1) {
        this.history.add('system', msg);
        this.history.save();
        
        if (code >= 0) {
            // Get the command line arguments that were used to start this process
            const args = process.argv.slice(1); // Remove 'node' from the arguments
            const mainScript = args[0]; // The main script file
            
            // Set a delay to ensure history is saved before restarting
            setTimeout(() => {
                // Spawn a new process with the same arguments
                const child = spawn(process.execPath, args, {
                    detached: true,
                    stdio: 'inherit'
                });
                
                // Unref the child to allow the parent to exit
                child.unref();
                
                // Exit the current process
                process.exit(0);
            }, 1000);
        } else {
            // Just exit without restarting
            process.exit(code);
        }
    }

    killAll() {
        serverProxy.shutdown();
    }
}
