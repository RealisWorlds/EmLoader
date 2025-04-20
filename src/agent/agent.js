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
import { patchChatWithDelay } from './library/skills.js';


import settings from '../../settings.js';
import { serverProxy } from './agent_proxy.js';
import { Task } from './tasks.js';
import { say } from './speak.js';
import { logger } from '../utils/logger.js';
import { spawn } from 'child_process';
import * as world from './library/world.js';


export class Agent {
    generating = 0;
    messageQueue = [];

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

        console.log(this.name, 'logging into minecraft...');
        this.bot = initBot(this.name);

        initModes(this);
        try {
            let save_data = null;
            if (load_mem) {
                save_data = this.history.load();
            }


            this.bot.on('login', () => {
                console.log(this.name, 'logged in!');

                serverProxy.login();
                
                // Set skin for profile, requires Fabric Tailor. (https://modrinth.com/mod/fabrictailor)
                if (this.prompter.profile.skin)
                    this.bot.chat(`/skin set URL ${this.prompter.profile.skin.model} ${this.prompter.profile.skin.path}`);
                else
                    this.bot.chat(`/skin clear`);
            });

            const spawnTimeout = setTimeout(() => {
                console.error('Bot failed to spawn within 30 seconds');
                process.exit(0);
            }, 30000);
            this.bot.once('spawn', async () => {
                try {
                    clearTimeout(spawnTimeout);
                    patchChatWithDelay(this.bot, 200);
                    console.log(`${this.name} spawned.`);
                    this.clearBotLogs();

                    this._setupEventHandlers(save_data, init_message);
                    this.startEvents();

                    if (!load_mem) {
                        this.task.initBotTask();
                    }

                    logger.debug('Initializing vision intepreter...');
                    this.vision_interpreter = new VisionInterpreter(this, settings.allow_vision);
                    addBrowserViewer(this, this.count_id);

                } catch (error) {
                    console.error('Error in spawn event:', error);
                    console.error('Error message: ' + error.message);
                    process.exit(0);
                }
            });
        } catch (err2) {
            console.error('Error in start:', err2);
            console.error('Error message: ' + err2.message);
        }
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

                logger.debug(`Handling respondFunc for ${username}: ${message}`);
	            let translation = await handleEnglishTranslation(message);
                logger.debug(`Translated message from ${username}`);
	            this.handleMessage(username, translation);
                logger.debug(`Handled respondFunc for ${username}`);
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
            await this.handleMessage('system', init_message, 2);
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

    async openChat(message) {
    	// We dont need to bother if no one is around
        let players = world.getNearbyPlayerNames(this.bot);
        if (players.length === 0) return;

        let to_translate = message;
        let remaining = '';
        let command_name = containsCommand(message);
        let translate_up_to = command_name ? message.indexOf(command_name) : -1;
        if (translate_up_to != -1) { // don't translate the command
            to_translate = to_translate.substring(0, translate_up_to);
            remaining = message.substring(translate_up_to);
        }
        message = (await handleTranslation(to_translate)).trim() + " " + remaining;
        // for each line ending with \n, if it starts with SYSTEM: then remove it
        message = message.replace(/(SYSTEM:.*?\n)/g, '');
        // for each line ending with \n, if it starts with Code output: then remove it
        message = message.replace(/(Code output:.*?\n)/g, '');
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

    async handleMessage(source, message, max_responses=null, future_call = false) {
        if (!source || !message || source === 'SPY') {
            console.warn('Received empty message from', source);
            return false;
        }
        if (!future_call) {
            // Now translate the message but don't update history yet
            message = await handleEnglishTranslation(message);
            console.log('received message from', source, ':', message);

            this.messageQueue.push({ source, message, max_responses });
            console.log(`Message from ${source} queued (${this.messageQueue.length} in queue) for later processing`);
            
            // If we're already generating a response, queue this message for later
            // if one generation is running and this.executing = true, we skip this if
            //if (this.generating >= settings.max_parallel_gen) {
            if (!(this.generating === 0 ||(this.generating === 1 && this.actions.executing))
                || this.generating >= settings.max_parallel_gen
            ) {
                // If there's already a pending handleMessage waiting, just return
                if (this.pendingHandleMessage) {
                    console.log(`A handleMessage is already pending.`);
                    return '';
                }
                    
                this.pendingHandleMessage = true;
                while (this.generating >= settings.max_parallel_gen) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            }
        } else {
            // Future call
            console.log(`Processing recursive call in handleMessage`);
        }
        this.generating++;
        let used_command = false;
    
        try {
            // Pop up to settings.max_messages messages from the queue and add them to history
            const messagesToProcess = []; // Start empty
            
            // Get up to settings.max_messages messages from the queue (if any)
            const maxMessagesToAdd = (settings.max_messages || 5);
            for (let i = 0; i < maxMessagesToAdd && this.messageQueue.length > 0; i++) {
                messagesToProcess.push(this.messageQueue.shift());
            }
            
            // Add all messages to history
            for (const msg of messagesToProcess) {
                await this.history.add(msg.source, msg.message);
                if (settings.show_bot_views) this.bot.emit('xmit_history', msg.source==='system'?'%system%':msg.source, msg.message);
            }
            this.history.save();
            
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
    
            const checkInterrupt = () => this.self_prompter.shouldInterrupt(self_prompt) || this.shut_up;
            
            let behavior_log = this.bot.modes.flushBehaviorLog().trim();
            if (behavior_log.length > 0) {
                const MAX_LOG = 500;
                if (behavior_log.length > MAX_LOG) {
                    behavior_log = '...' + behavior_log.substring(behavior_log.length - MAX_LOG);
                }
                behavior_log = 'Recent behaviors log: \n' + behavior_log;
                await this.history.add('system', behavior_log);
                if (settings.show_bot_views) this.bot.emit('xmit_history', '%system%', behavior_log);
            }
    
            if (!self_prompt && this.self_prompter.isActive()) // message is from user during self-prompting
                max_responses = 1; // force only respond to this message, then let self-prompting take over
            for (let i=0; i<max_responses; i++) {
                if (checkInterrupt()) break;
                let history = this.history.getHistory();
                
                let res;
                try {
                    res = await this.prompter.promptConvo(history);
                    if (res.length > settings.max_response_length) {
                        res = res.substring(0, settings.max_response_length);
                    }
                } catch (promptError) {
                    console.error(`Error in promptConvo for ${this.name}:`, promptError);
                    continue;
                }
    
                console.log(`${this.name} full response to ${source}: ""${res}""`);
                
                if (res?.trim().length === 0) { 
                    console.warn('no response')
                    break; // empty response ends loop
                }
    
                let command_name = containsCommand(res);
    
                if (command_name) { // contains query or command
                    res = truncCommandMessage(res); // everything after the command is ignored
                    this.history.add(this.name, res);
                    if (settings.show_bot_views) this.bot.emit('xmit_history', this.name, res);
                    
                    if (!commandExists(command_name)) {
                        this.history.add('system', `Command ${command_name} does not exist.`);
                        console.warn('Agent hallucinated command:', command_name)
                        continue;
                    }
    
                    if (checkInterrupt()) break;
                    this.self_prompter.handleUserPromptedCmd(self_prompt, isAction(command_name));
    
                    if (settings.verbose_commands) {
                        this.routeResponse(source, res);
                    }
                    else { // only output command name
                        let pre_message = res.substring(0, res.indexOf(command_name)).trim();
                        let chat_message = `*used ${command_name.substring(1)}*`;
                        if (pre_message.length > 0)
                            chat_message = `${pre_message}`;
                        this.routeResponse(source, chat_message);
                    }
    
                    let execute_res;
                    try {
                        execute_res = await executeCommand(this, res);
                    } catch (cmdError) {
                        console.error(`Error executing command ${command_name}:`, cmdError, cmdError.message);
                        console.error(cmdError.stack);
                        this.history.add('system', `Error executing command ${command_name}: ${cmdError.message || 'Unknown error'}`);
                        continue;
                    }
    
                    logger.info('Agent executed:', command_name, 'and got:', execute_res);
                    used_command = true;
    
                    if (execute_res) {
                        logger.debug('Adding execute result to history.');
                        this.history.add('system', execute_res);
                        if (settings.show_bot_views) this.bot.emit('xmit_history', '%system%', execute_res);
                        logger.debug('History updated.');
                    } else {
                        logger.debug('execute_res was false');
                        break;
                    }
                }
                else { // conversation response
                    logger.debug('Adding conversation response to history.');
                    this.history.add(this.name, res);
                    if (settings.show_bot_views) this.bot.emit('xmit_history', this.name, res);
                    this.routeResponse(source, res);
                    logger.debug('Conversation response history updated.');
                    break;
                }
                logger.debug('saving history in handleMessage');
                this.history.save();
                logger.debug('History saved in handleMessage');
            }
            return used_command;
        } finally {
            if (this.generating>0) {
                this.generating--;
            }
            
            // Only process the queue if there are messages and no pending handleMessage
            if (this.messageQueue.length > 0 && !this.pendingHandleMessage) {                
                logger.debug(`Processing next message from ${nextMessage.source} (queued ${this.messageQueue.length} remaining)`);
                setTimeout(() => {
                    this.handleMessage(nextMessage.source, nextMessage.message, nextMessage.max_responses, true);
                }, 0);
            }
        }
    }

    async routeResponse(to_player, message) {
        if (this.shut_up) return;
        let self_prompt = to_player === 'system' || to_player === this.name;
        if (self_prompt && this.last_sender) {
            // so it can respond to events like death but be routed back to the last sender
            to_player = this.last_sender;
        }

        // otherwise, use open chat
        this.openChat(message);
        // note that to_player could be another bot, but if we get here the conversation has ended
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
            if (reason.value && reason.value.extra) {
                console.warn('Bot kicked with extra:', reason.value.extra);
            }
            if (reason.value && reason.value.extra && reason.value.extra.value) {
                console.warn('Bot kicked with extra value:', reason.value.extra.value);
                console.warn('Bot kicked with extra value:', reason.value.extra.value.value);
            }
            this.cleanKill('Bot kicked! Killing agent process.');
        });
        this.bot.on('messagestr', async (message, _, jsonMsg) => {
            if (jsonMsg.translate && jsonMsg.translate.startsWith('death') && message.startsWith(this.name)) {
                console.log('Agent died: ', message);
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
	            this.actions.resumeAction();
            } catch (error) {
                logger.error('Error in idle event:', error);
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
        await this.bot.modes.update();
        this.self_prompter.update(delta);
        if (this.task.data) {
            let res = this.task.isDone();
            if (res) {
                await this.history.add('system', `${res.message} ended with code : ${res.code}`);
                await this.history.save();
                console.log('Task finished:', res.message);
                this.killAll();
            }
        }
    }

    isIdle() {
        return !this.actions.executing;
    }

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
