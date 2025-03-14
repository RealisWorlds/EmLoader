import { readFileSync, mkdirSync, writeFileSync} from 'fs';
import { Examples } from '../utils/examples.js';
import { getCommandDocs } from '../agent/commands/index.js';
import { getSkillDocs } from '../agent/library/index.js';
import { SkillLibrary } from "../agent/library/skill_library.js";
import { stringifyTurns } from '../utils/text.js';
import { getCommand } from '../agent/commands/index.js';
import settings from '../../settings.js';
import { QdrantClient } from '@qdrant/js-client-rest';
import { MemoryManager } from './memory.js';

import { Gemini } from './gemini.js';
import { GPT } from './gpt.js';
import { Claude } from './claude.js';
import { Mistral } from './mistral.js';
import { ReplicateAPI } from './replicate.js';
import { Local } from './local.js';
import { Novita } from './novita.js';
import { GroqCloudAPI } from './groq.js';
import { HuggingFace } from './huggingface.js';
import { Qwen } from "./qwen.js";
import { Grok } from "./grok.js";

export class Prompter {
    constructor(agent, fp, memory) {
        this.agent = agent;
        this.profile = JSON.parse(readFileSync(fp, 'utf8'));
        let default_profile = JSON.parse(readFileSync('./profiles/defaults/_default.json', 'utf8'));
        let base_fp = settings.base_profile;
        let base_profile = JSON.parse(readFileSync(base_fp, 'utf8'));

        // first use defaults to fill in missing values in the base profile
        for (let key in default_profile) {
            if (base_profile[key] === undefined) {
                base_profile[key] = default_profile[key];
            }
        }
        // then use base profile to fill in missing values in the individual profile
        for (let key in base_profile) {
            if (this.profile[key] === undefined) {
                this.profile[key] = base_profile[key];
            }
        }
        // base overrides default, individual overrides base


        this.convo_examples = null;
        this.coding_examples = null;
        
        let name = this.profile.name;
        this.cooldown = this.profile.cooldown ? this.profile.cooldown : 0;
        this.last_prompt_time = 0;
        this.awaiting_coding = false;

        // try to get "max_tokens" parameter, else null
        let max_tokens = null;
        if (this.profile.max_tokens) {
            max_tokens = this.profile.max_tokens;
        }

        let chat_model_profile = this._selectAPI(this.profile.model);
        this.chat_model = this._createModel(chat_model_profile);

        if (this.profile.code_model) {
            let code_model_profile = this._selectAPI(this.profile.code_model);
            this.code_model = this._createModel(code_model_profile);
        }
        else {
            this.code_model = this.chat_model;
        }

        let embedding = this.profile.embedding;
        if (embedding === undefined) {
            if (chat_model_profile.api !== 'ollama') {
                embedding = {api: chat_model_profile.api};
            } else {
                embedding = {api: 'none'};
            }
        } else if (typeof embedding === 'string' || embedding instanceof String) {
            embedding = {api: embedding};
        }
        else {
            embedding = {api: 'ollama'};
        }

        console.log('Using embedding settings:', embedding);

        try {
            if (embedding.api === 'google') {
                this.embedding_model = new Gemini(embedding.model, embedding.url);
            } else if (embedding.api === 'openai') {
                this.embedding_model = new GPT(embedding.model, embedding.url);
            } else if (embedding.api === 'replicate') {
                this.embedding_model = new ReplicateAPI(embedding.model, embedding.url);
            } else if (embedding.api === 'ollama') {
                this.embedding_model = new Local(embedding.model, embedding.url);
            } else if (embedding.api === 'qwen') {
                this.embedding_model = new Qwen(embedding.model, embedding.url);
            } else if (embedding.api === 'mistral') {
                this.embedding_model = new Mistral(embedding.model, embedding.url);
            } else if (embedding.api === 'huggingface') {
                this.embedding_model = new HuggingFace(embedding.model, embedding.url);
            } else if (embedding.api === 'novita') {
                this.embedding_model = new Novita(embedding.model, embedding.url);
            } else {
                this.embedding_model = null;
                let embedding_name = embedding ? embedding.api : '[NOT SPECIFIED]';
                console.warn('Unsupported embedding: ' + embedding_name + '. Using word-overlap instead, expect reduced performance. Recommend using a supported embedding model. See Readme.');
            }
        }
        catch (err) {
            console.warn('Warning: Failed to initialize embedding model:', err.message);
            console.log('Continuing anyway, using word-overlap instead.');
            this.embedding_model = null;
        }
        
        // Initialize memory system
        this.memory = new MemoryManager(this.agent, this.embedding_model, memory);

        this.skill_libary = new SkillLibrary(agent, this.embedding_model);
        mkdirSync(`./bots/${name}`, { recursive: true });
        writeFileSync(`./bots/${name}/last_profile.json`, JSON.stringify(this.profile, null, 4), (err) => {
            if (err) {
                throw new Error('Failed to save profile:', err);
            }
            console.log("Copy profile saved.");
        });
    }

    _selectAPI(profile) {
        if (typeof profile === 'string' || profile instanceof String) {
            profile = {model: profile};
        }
        if (!profile.api) {
            if (profile.model.includes('gemini')) {
                profile.api = 'google';
            } else if (profile.model.includes('openrouter/')) {
                profile.api = 'openrouter'; // must do before others bc shares model names
            } else if (profile.model.includes('gpt') || profile.model.includes('o1')|| profile.model.includes('o3')) {
                profile.api = 'openai';
            } else if (profile.model.includes('claude')) {
                profile.api = 'anthropic';
            } else if (profile.model.includes('huggingface/')) {
                profile.api = "huggingface";
            } else if (profile.model.includes('replicate/')) {
                profile.api = 'replicate';
            } else if (profile.model.includes('mistralai/') || profile.model.includes("mistral/")) {
                profile.api = 'mistral';
            } else if (profile.model.includes("groq/") || profile.model.includes("groqcloud/")) {
                profile.api = 'groq';
            } else if (profile.model.includes('novita/')) {
                profile.api = 'novita';
            } else if (profile.model.includes('qwen')) {
                profile.api = 'qwen';
            } else if (profile.model.includes('grok')) {
                profile.api = 'xai';
            } else if (profile.model.includes('deepseek')) {
                profile.api = 'deepseek';
            } else {
                profile.api = 'ollama';
            }
        }

        // allow overriding via params
        if (profile.params) {
            if (profile.params.api) {
                profile.api = profile.params.api;
                delete profile.params.api;
            }
        }
        if (!profile.params)
            profile.params = {};
        return profile;
    }

    _createModel(profile) {
        if (profile.api === 'google') {
            return new Gemini(profile.model, profile.url, profile.params);
        } else if (profile.api === 'openai') {
            return new GPT(profile.model, profile.url, profile.params);
        } else if (profile.api === 'ollama') {
            return new Local(profile.model, profile.url, profile.params);
        } else if (profile.api === 'anthropic') {
            return new Claude(profile.model, profile.url, profile.params);
        } else if (profile.api === 'replicate') {
            return new ReplicateAPI(profile.model, profile.url, profile.params);
        } else if (profile.api === 'openrouter') {
            return new GPT(profile.model, "https://openrouter.ai/api/v1", profile.params);
        } else if (profile.api === 'mistral') {
            return new Mistral(profile.model, profile.url, profile.params);
        } else if (profile.api === 'novita') {
            return new Novita(profile.model, profile.url, profile.params);
        } else if (profile.api === 'deepseek') {
            return new HuggingFace(profile.model, profile.url, profile.params); // same api diff model
        } else if (profile.api === 'groq') {
            return new GroqCloudAPI(profile.model, profile.url, profile.params);
        } else if (profile.api === 'qwen') {
            return new Qwen(profile.model, profile.url, profile.params);
        } else if (profile.api === 'xai') {
            return new Grok(profile.model, profile.url, profile.params);
        } else if (profile.api === 'huggingface') {
            return new HuggingFace(profile.model, profile.url, profile.params);
        } else {
            // unrecognized, so assume local/ollama
            return new Local(profile.model, profile.url, profile.params);
        }
    }

    getName() {
        return this.profile.name;
    }

    getInitModes() {
        return this.profile.init_modes || [];
    }

    async initExamples() {
        try {
            this.convo_examples = new Examples(this.embedding_model, settings.num_examples);
            this.coding_examples = new Examples(this.embedding_model, settings.num_examples);
            
            // Wait for both examples to load before proceeding
            await Promise.all([
                this.convo_examples.load(this.profile.conversation_examples),
                this.coding_examples.load(this.profile.coding_examples),
                this.skill_libary.initSkillLibrary()
            ]).catch(error => {
                // Preserve error details
                console.error('Failed to initialize examples. Error details:', error);
                console.error('Stack trace:', error.stack);
                throw error;
            });

            console.log('Examples initialized.');
        } catch (error) {
            console.error('Failed to initialize examples:', error);
            console.error('Stack trace:', error.stack);
            throw error; // Re-throw with preserved details
        }
    }

    async replaceStrings(prompt, messages, examples=null, to_summarize=[], last_goals=null) {
        prompt = prompt.replaceAll('$NAME', this.agent.name);

        if (prompt.includes('$STATS')) {
            let stats = await getCommand('!stats').perform(this.agent);
            prompt = prompt.replaceAll('$STATS', stats);
        }
        if (prompt.includes('$INVENTORY')) {
            let inventory = await getCommand('!inventory').perform(this.agent);
            prompt = prompt.replaceAll('$INVENTORY', inventory);
        }
        if (prompt.includes('$ACTION')) {
            prompt = prompt.replaceAll('$ACTION', this.agent.actions.currentActionLabel);
        }
        if (prompt.includes('$COMMAND_DOCS'))
            prompt = prompt.replaceAll('$COMMAND_DOCS', getCommandDocs());
        if (prompt.includes('$CODE_DOCS')) {
            const code_task_content = messages.slice().reverse().find(msg =>
                msg.role !== 'system' && msg.content.includes('!newAction(')
            )?.content?.match(/!newAction\((.*?)\)/)?.[1] || '';

            prompt = prompt.replaceAll(
                '$CODE_DOCS',
                await this.skill_libary.getRelevantSkillDocs(code_task_content, settings.relevant_docs_count)
            );
        }
            prompt = prompt.replaceAll('$COMMAND_DOCS', getCommandDocs());
        if (prompt.includes('$CODE_DOCS'))
            prompt = prompt.replaceAll('$CODE_DOCS', getSkillDocs());
        if (prompt.includes('$EXAMPLES') && examples !== null)
            prompt = prompt.replaceAll('$EXAMPLES', await examples.createExampleMessage(messages));       
     
        if (prompt.includes('$MEMORY'))
            prompt = prompt.replaceAll('$MEMORY', this.agent.history.memory);
        if (prompt.includes('$TO_SUMMARIZE'))
            prompt = prompt.replaceAll('$TO_SUMMARIZE', stringifyTurns(to_summarize));
        if (prompt.includes('$CONVO'))
            prompt = prompt.replaceAll('$CONVO', 'Recent conversation:\n' + stringifyTurns(messages));
        if (prompt.includes('$SELF_PROMPT')) {
            // if active or paused, show the current goal
            let self_prompt = !this.agent.self_prompter.isStopped() ? `YOUR CURRENT ASSIGNED GOAL: "${this.agent.self_prompter.prompt}"\n` : '';
            prompt = prompt.replaceAll('$SELF_PROMPT', self_prompt);
        }
        if (prompt.includes('$LONG_TERM_MEMORY')) {
            try {
                if (messages && messages.length > 0) {
                    const lastMessage = messages[messages.length - 1];
                    const relevantMemories = await this.memory.retrieveRelevantMemories(lastMessage.content, 3);
                    prompt = prompt.replaceAll('$LONG_TERM_MEMORY', relevantMemories);
                } else {
                    prompt = prompt.replaceAll('$LONG_TERM_MEMORY', "No long-term memories available.");
                }
            } catch (error) {
                console.error('Error handling $LONG_TERM_MEMORY placeholder:', error);
                prompt = prompt.replaceAll('$LONG_TERM_MEMORY', "Error retrieving long-term memories.");
            }
        }
        if (prompt.includes('$LAST_GOALS')) {
            let goal_text = '';
            for (let goal in last_goals) {
                if (last_goals[goal])
                    goal_text += `You recently successfully completed the goal ${goal}.\n`
                else
                    goal_text += `You recently failed to complete the goal ${goal}.\n`
            }
            prompt = prompt.replaceAll('$LAST_GOALS', goal_text.trim());
        }
        if (prompt.includes('$BLUEPRINTS')) {
            if (this.agent.npc.constructions) {
                let blueprints = '';
                for (let blueprint in this.agent.npc.constructions) {
                    blueprints += blueprint + ', ';
                }
                prompt = prompt.replaceAll('$BLUEPRINTS', blueprints.slice(0, -2));
            }
        }
        // Add support for $EXPERIENCE which is used in memory prompts
        if (prompt.includes('$EXPERIENCE') && to_summarize && to_summarize.length > 0) {
            prompt = prompt.replaceAll('$EXPERIENCE', stringifyTurns(to_summarize));
        }

        // check if there are any remaining placeholders with syntax $<word>
        let remaining = prompt.match(/\$[A-Z_]+/g);
        if (remaining !== null) {
            console.warn('Unknown prompt placeholders:', remaining.join(', '));
        }
        return prompt;
    }

    async checkCooldown() {
        let elapsed = Date.now() - this.last_prompt_time;
        if (elapsed < this.cooldown && this.cooldown > 0) {
            await new Promise(r => setTimeout(r, this.cooldown - elapsed));
        }
        this.last_prompt_time = Date.now();
    }

    async promptConvo(messages) {
        this.most_recent_msg_time = Date.now();
        let current_msg_time = this.most_recent_msg_time;
        for (let i = 0; i < 3; i++) { // try 3 times to avoid hallucinations
            await this.checkCooldown();
            if (current_msg_time !== this.most_recent_msg_time) {
                return '';
            }
            let prompt = this.profile.conversing;
            prompt = await this.replaceStrings(prompt, messages, this.convo_examples);
            let generation = await this.chat_model.sendRequest(messages, prompt);
            // in conversations >2 players LLMs tend to hallucinate and role-play as other bots
            // the FROM OTHER BOT tag should never be generated by the LLM
            if (generation.includes('(FROM OTHER BOT)')) {
                console.warn('LLM hallucinated message as another bot. Trying again...');
                continue;
            }
            if (current_msg_time !== this.most_recent_msg_time) {
                console.warn(this.agent.name + ' received new message while generating, discarding old response.');
                return '';
            }
            return generation;
        }
        return '';
    }

    async promptCoding(messages) {
        if (this.awaiting_coding) {
            console.warn('Already awaiting coding response, returning no response.');
            return '```//no response```';
        }
        this.awaiting_coding = true;
        await this.checkCooldown();
        let prompt = this.profile.coding;
        prompt = await this.replaceStrings(prompt, messages, this.coding_examples);
        let resp = await this.code_model.sendRequest(messages, prompt);
        this.awaiting_coding = false;
        return resp;
    }

    async promptMemSaving(to_summarize) {
        await this.checkCooldown();
        let prompt = this.profile.saving_memory;
        prompt = await this.replaceStrings(prompt, null, null, to_summarize);
        return await this.chat_model.sendRequest([], prompt);
    }

    async promptShouldRespondToBot(new_message) {
        await this.checkCooldown();
        let prompt = this.profile.bot_responder;
        let messages = this.agent.history.getHistory();
        messages.push({role: 'user', content: new_message});
        prompt = await this.replaceStrings(prompt, messages);
        let res = await this.chat_model.sendRequest([], prompt);
        return res.trim().toLowerCase() === 'respond';
    }

    async promptGoalSetting(messages, last_goals) {
        let system_message = this.profile.goal_setting;
        system_message = await this.replaceStrings(system_message, messages);

        let user_message = 'Use the below info to determine what goal to target next\n\n';
        user_message += '$LAST_GOALS\n$STATS\n$INVENTORY\n$CONVO'
        user_message = await this.replaceStrings(user_message, messages, null, null, last_goals);
        let user_messages = [{role: 'user', content: user_message}];

        let res = await this.chat_model.sendRequest(user_messages, system_message);

        let goal = null;
        try {
            let data = res.split('```')[1].replace('json', '').trim();
            goal = JSON.parse(data);
        } catch (err) {
            console.log('Failed to parse goal:', res, err);
        }
        if (!goal || !goal.name || !goal.quantity || isNaN(parseInt(goal.quantity))) {
            console.log('Failed to set goal:', res);
            return null;
        }
        goal.quantity = parseInt(goal.quantity);
        return goal;
    }

    async storeMemory(text, metadata = {}) {
        if (!text || text.trim() === '') {
            console.warn('Generated empty memory text, nothing to store');
            return;
        }
        
        if (this.memory) {
            await this.memory.storeMemory(text, metadata);
        } else {
            console.warn('Memory system not available, unable to store memory');
        }
    }
    
    async retrieveRelevantMemories(query, limit = 10, options = {}) {
        if (this.memory) {
            return await this.memory.retrieveRelevantMemories(query, limit, options);
        } else {
            return "Memory system not available.";
        }
    }
    
    async addTagsToMemory(memoryId, tags = []) {
        if (this.memory) {
            return await this.memory.addTagsToMemory(memoryId, tags);
        }
        return false;
    }
    
    async searchMemoriesByTags(tags = [], limit = 10) {
        if (this.memory) {
            return await this.memory.searchMemoriesByTags(tags, limit);
        }
        return "Memory system not available.";
    }
    
    async getMemoryStats() {
        if (this.memory) {
            return await this.memory.getMemoryStats();
        }
        return "Memory system not available.";
    }
    
    async forgetMemory(memoryId) {
        if (this.memory) {
            return await this.memory.forgetMemory(memoryId);
        }
        return false;
    }
    
    async updateMemoryImportance(memoryId, importance) {
        if (this.memory) {
            return await this.memory.updateMemoryImportance(memoryId, importance);
        }
        return false;
    }

    async promptMemoryStorage(message, importance = "medium") {
        if (!this.memory) {
            console.warn('Cannot prompt memory storage: Memory system not available');
            return;
        }
        
        console.log(`Processing message for memory storage (importance: ${importance}): "${message.substring(0, 100)}..."`);
        
        await this.checkCooldown();
        let prompt = this.profile.memory_storage || 
            `You are $NAME and are processing your experience into memory to recall later, Add details that will help you remember the experience. When someone asks you about the past you need to write in a way where you will remember easily.            
            """
            $EXPERIENCE
            """
            Don't explain your reasoning, just provide the memory directly.`;
        
        // Save the message content to be used by replaceStrings when it encounters $EXPERIENCE
        let experienceContent = [{role: 'user', content: message}];
        
        // Apply all replacements through the central replacement method
        prompt = await this.replaceStrings(prompt, experienceContent, null, experienceContent);
        
        // At this point, if $EXPERIENCE wasn't replaced properly (due to different format than expected)
        // or if profile uses $MESSAGE instead, manually replace remaining placeholders
        if (prompt.includes('$EXPERIENCE')) {
            prompt = prompt.replace(/\$EXPERIENCE/g, message);
        }
        if (prompt.includes('$MESSAGE')) {
            prompt = prompt.replace(/\$MESSAGE/g, message);
        }
        
        console.log('Sending memory prompt for processing...');
        const memoryText = await this.chat_model.sendRequest([], prompt);
        
        if (memoryText && memoryText.trim()) {
            console.log(`Generated memory text: "${memoryText.trim()}"`);
            const success = await this.storeMemory(memoryText.trim(), {
                importance: importance,
                source: "conversation"
            });
            
            if (success) {
                console.log(' Memory successfully stored in vector database');
            } else {
                console.warn('Failed to store memory in vector database');
            }
        } else {
            console.warn('Generated empty memory text, nothing to store');
        }
    }
}
