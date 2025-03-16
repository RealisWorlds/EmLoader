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

// Import LLM model handlers
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

// Import service modules
import { StateManager } from './services/state_manager.js';
import { EventBus } from './services/event_bus.js';
import { ModelService } from './services/model_service.js';
import { MemoryService } from './services/memory_service.js';
import { PromptService } from './services/prompt_service.js';

export class EnhancedPrompter {
    constructor(agent, fp, memory) {
        this.agent = agent;
        
        // Load configuration from profiles
        this.profile = JSON.parse(readFileSync(fp, 'utf8'));
        let default_profile = JSON.parse(readFileSync('./profiles/defaults/_default.json', 'utf8'));
        let base_fp = settings.base_profile;
        let base_profile = JSON.parse(readFileSync(base_fp, 'utf8'));

        // Profile inheritance: individual overrides base, base overrides default
        for (let key in default_profile) {
            if (base_profile[key] === undefined) {
                base_profile[key] = default_profile[key];
            }
        }
        for (let key in base_profile) {
            if (this.profile[key] === undefined) {
                this.profile[key] = base_profile[key];
            }
        }
        
        // Basic properties
        this.convo_examples = null;
        this.coding_examples = null;
        let name = this.profile.name;
        this.cooldown = this.profile.cooldown ? this.profile.cooldown : 0;
        this.most_recent_msg_time = 0;
        
        // Initialize service architecture
        this.stateManager = new StateManager();
        this.eventBus = new EventBus();
        this.modelService = new ModelService(this.profile);
        this.memoryService = new MemoryService(
            null, // We'll set this after initializing embedding model
            this.profile.vectorDb || {}
        );
        this.promptService = new PromptService(this.profile);
        
        // Connect services to agent
        this.promptService.setAgent(agent);
        
        // Setup event listeners
        this._setupEventListeners();
        
        // Initialize models and embedding model
        this._initializeModels();
        
        // Make workspace directory
        mkdirSync(`./bots/${name}`, { recursive: true });
        writeFileSync(`./bots/${name}/last_profile.json`, JSON.stringify(this.profile, null, 4), (err) => {
            if (err) {
                console.error('Failed to save profile:', err);
            } else {
                console.log("Copy profile saved.");
            }
        });
    }
    
    /**
     * Setup event listeners for inter-service communication
     */
    _setupEventListeners() {
        this.eventBus.on('model:error', (error) => {
            console.error('Model error occurred:', error);
            this.stateManager.transition(this.stateManager.STATES.ERROR, { error });
        });
        
        this.eventBus.on('memory:stored', (memory) => {
            console.log('Memory stored:', memory.id);
        });
        
        this.stateManager.onTransition(this.stateManager.STATES.ERROR, (fromState, data) => {
            console.warn(`Transitioned to ERROR state from ${fromState}:`, data.error);
            // Attempt recovery after a short delay
            setTimeout(() => {
                if (this.stateManager.getCurrentState() === this.stateManager.STATES.ERROR) {
                    console.log('Attempting recovery from error state');
                    this.stateManager.transition(this.stateManager.STATES.IDLE);
                }
            }, 5000);
        });
        
        this.stateManager.onTransition(this.stateManager.STATES.IDLE, () => {
            // Reset any in-progress flags when returning to idle
            this.awaiting_coding = false;
        });
    }
    
    /**
     * Initialize language models and embedding model
     */
    _initializeModels() {
        // Configure chat model
        let chat_model_profile = this._selectAPI(this.profile.model);
        const chatModel = this._createModel(chat_model_profile);
        this.modelService.registerModel('chat', chatModel);
        this.chat_model = chatModel; // For backwards compatibility
        
        // Configure code model (use chat model if not specified)
        if (this.profile.code_model) {
            let code_model_profile = this._selectAPI(this.profile.code_model);
            const codeModel = this._createModel(code_model_profile);
            this.modelService.registerModel('code', codeModel);
            this.code_model = codeModel; // For backwards compatibility
            
            // Set fallback - if code model fails, use chat model
            this.modelService.registerFallback('code', 'chat');
        } else {
            this.modelService.registerModel('code', chatModel);
            this.code_model = chatModel; // For backwards compatibility
        }
        
        // Configure embedding model
        let embedding = this.profile.embedding;
        if (embedding === undefined) {
            if (chat_model_profile.api !== 'ollama') {
                embedding = {api: chat_model_profile.api};
            } else {
                embedding = {api: 'none'};
            }
        } else if (typeof embedding === 'string' || embedding instanceof String) {
            embedding = {api: embedding};
        } else {
            embedding = {api: 'ollama'};
        }
        
        console.log('Using embedding settings:', embedding);
        
        try {
            let embeddingModel = null;
            
            if (embedding.api === 'google') {
                embeddingModel = new Gemini(embedding.model, embedding.url);
            } else if (embedding.api === 'openai') {
                embeddingModel = new GPT(embedding.model, embedding.url);
            } else if (embedding.api === 'replicate') {
                embeddingModel = new ReplicateAPI(embedding.model, embedding.url);
            } else if (embedding.api === 'ollama') {
                embeddingModel = new Local(embedding.model, embedding.url);
            } else if (embedding.api === 'qwen') {
                embeddingModel = new Qwen(embedding.model, embedding.url);
            } else if (embedding.api === 'mistral') {
                embeddingModel = new Mistral(embedding.model, embedding.url);
            } else if (embedding.api === 'huggingface') {
                embeddingModel = new HuggingFace(embedding.model, embedding.url);
            } else if (embedding.api === 'novita') {
                embeddingModel = new Novita(embedding.model, embedding.url);
            } else {
                let embedding_name = embedding ? embedding.api : '[NOT SPECIFIED]';
                console.warn('Unsupported embedding: ' + embedding_name + '. Using word-overlap instead, expect reduced performance.');
                embeddingModel = null;
            }
            
            this.embedding_model = embeddingModel;
            
            // Initialize memory service with embedding model
            this.memoryService.initialize(MemoryManager, embeddingModel);
            this.memory = this.memoryService; // For backwards compatibility
            
            // Initialize skill library with embedding model
            this.skill_libary = new SkillLibrary(this.agent, embeddingModel);
        } catch (err) {
            console.error('Failed to initialize embedding model:', err);
            console.log('Using fallback word-overlap method. Performance may be reduced.');
            this.embedding_model = null;
            
            // Still initialize services with null embedding model
            this.memoryService.initialize(MemoryManager, null);
            this.memory = this.memoryService;
            this.skill_libary = new SkillLibrary(this.agent, null);
        }
    }
    
    /**
     * Select appropriate API based on model name or profile
     * @param {Object|string} profile - Model profile or name
     * @returns {Object} Configured profile with API
     */
    _selectAPI(profile) {
        if (typeof profile === 'string' || profile instanceof String) {
            profile = {model: profile};
        }
        
        if (!profile.api) {
            // Auto-detect API based on model name
            if (profile.model.includes('gemini')) {
                profile.api = 'google';
            } else if (profile.model.includes('openrouter/')) {
                profile.api = 'openrouter';
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

        // Allow overriding via params
        if (profile.params) {
            if (profile.params.api) {
                profile.api = profile.params.api;
                delete profile.params.api;
            }
        }
        
        if (!profile.params) {
            profile.params = {};
        }
        
        return profile;
    }
    
    /**
     * Create model instance based on profile
     * @param {Object} profile - Model profile
     * @returns {Object} Model instance
     */
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
            return new HuggingFace(profile.model, profile.url, profile.params);
        } else if (profile.api === 'groq') {
            return new GroqCloudAPI(profile.model, profile.url, profile.params);
        } else if (profile.api === 'qwen') {
            return new Qwen(profile.model, profile.url, profile.params);
        } else if (profile.api === 'xai') {
            return new Grok(profile.model, profile.url, profile.params);
        } else if (profile.api === 'huggingface') {
            return new HuggingFace(profile.model, profile.url, profile.params);
        } else {
            // Default to local/ollama
            return new Local(profile.model, profile.url, profile.params);
        }
    }
    
    /**
     * Get agent name
     * @returns {string} Agent name
     */
    getName() {
        return this.profile.name;
    }
    
    /**
     * Get initialization modes
     * @returns {Array} Initialization modes
     */
    getInitModes() {
        return this.profile.init_modes || [];
    }
    
    /**
     * Initialize example datasets
     * @returns {Promise<void>}
     */
    async initExamples() {
        try {
            this.convo_examples = new Examples(this.embedding_model, settings.num_examples);
            this.coding_examples = new Examples(this.embedding_model, settings.num_examples);
            
            // Initialize all at once
            await Promise.all([
                this.convo_examples.load(this.profile.conversation_examples),
                this.coding_examples.load(this.profile.coding_examples),
                this.skill_libary.initSkillLibrary()
            ]).catch(error => {
                console.error('Failed to initialize examples:', error);
                throw error;
            });

            console.log('Examples initialized successfully');
        } catch (error) {
            console.error('Failed to initialize examples:', error);
            console.error('Stack trace:', error.stack);
            throw error;
        }
    }
    
    /**
     * Process a conversation prompt
     * @param {Array} messages - Conversation messages
     * @returns {Promise<string>} Generated response
     */
    async promptConvo(messages) {
        // Record message time to handle race conditions
        this.most_recent_msg_time = Date.now();
        let current_msg_time = this.most_recent_msg_time;
        
        // Check if we can transition to processing state
        if (!this.stateManager.transition(this.stateManager.STATES.PROCESSING_CHAT)) {
            console.warn('Cannot process conversation in current state:', this.stateManager.getCurrentState());
            return '';
        }
        
        // Try up to 3 times to handle possible hallucinations
        for (let i = 0; i < 3; i++) {
            try {
                // Make sure we're still processing the latest message
                if (current_msg_time !== this.most_recent_msg_time) {
                    console.log('Received newer message while generating, discarding old response');
                    this.stateManager.transition(this.stateManager.STATES.IDLE);
                    return '';
                }
                
                // Prepare the prompt
                const prompt = await this.promptService.prepareConversationPrompt(messages);
                
                // Get response with automatic retries
                const generation = await this.modelService.sendChatRequest(messages, prompt, {
                    timeout: 30000, // 30 second timeout
                    maxRetries: 2,
                    backoffFactor: 1.5
                });
                
                // In conversations >2 players LLMs tend to hallucinate and role-play as other bots
                if (generation.includes('(FROM OTHER BOT)')) {
                    console.warn('LLM hallucinated message as another bot. Trying again...');
                    continue;
                }
                
                // Final check for newer messages
                if (current_msg_time !== this.most_recent_msg_time) {
                    console.warn(this.agent.name + ' received new message while generating, discarding old response');
                    this.stateManager.transition(this.stateManager.STATES.IDLE);
                    return '';
                }
                
                // Success
                this.stateManager.transition(this.stateManager.STATES.IDLE);
                return generation;
            } catch (error) {
                console.error(`Error in conversation prompt attempt ${i + 1}/3:`, error);
                // Continue to next attempt
            }
        }
        
        // All attempts failed
        console.error('All conversation generation attempts failed');
        this.stateManager.transition(this.stateManager.STATES.ERROR, { 
            error: new Error('Failed to generate conversation response after multiple attempts')
        });
        return '';
    }
    
    /**
     * Process a code generation prompt
     * @param {Array} messages - Conversation messages
     * @returns {Promise<string>} Generated code
     */
    async promptCoding(messages) {
        // Prevent concurrent code generation
        if (this.stateManager.getCurrentState() === this.stateManager.STATES.PROCESSING_CODE) {
            console.warn('Already processing code, cannot start another code generation');
            return '```//no response```';
        }
        
        // Transition to code processing state
        if (!this.stateManager.transition(this.stateManager.STATES.PROCESSING_CODE)) {
            console.warn('Cannot process code in current state:', this.stateManager.getCurrentState());
            return '```//no response```';
        }
        
        try {
            // Prepare the prompt
            const prompt = await this.promptService.prepareCodePrompt(messages);
            
            // Get code generation with automatic retries
            const response = await this.modelService.sendCodeRequest(messages, prompt, {
                timeout: 45000, // 45 second timeout for code generation
                maxRetries: 2
            });
            
            this.stateManager.transition(this.stateManager.STATES.IDLE);
            return response;
        } catch (error) {
            console.error('Error in code generation:', error);
            this.stateManager.transition(this.stateManager.STATES.ERROR, { error });
            return '```//Error generating code```';
        }
    }
    
    /**
     * Process a memory saving prompt
     * @param {Array} to_summarize - Messages to summarize
     * @returns {Promise<string>} Generated memory
     */
    async promptMemSaving(to_summarize) {
        if (!this.stateManager.transition(this.stateManager.STATES.PROCESSING_MEMORY)) {
            console.warn('Cannot process memory in current state:', this.stateManager.getCurrentState());
            return '';
        }
        
        try {
            const prompt = await this.promptService.prepareMemorySavingPrompt(to_summarize);
            const response = await this.modelService.sendChatRequest([], prompt, {
                timeout: 15000 // 15 second timeout for memory processing
            });
            
            this.stateManager.transition(this.stateManager.STATES.IDLE);
            return response;
        } catch (error) {
            console.error('Error in memory saving:', error);
            this.stateManager.transition(this.stateManager.STATES.ERROR, { error });
            return '';
        }
    }
    
    /**
     * Determine if agent should respond to a bot message
     * @param {string} new_message - New message content
     * @returns {Promise<boolean>} Whether agent should respond
     */
    async promptShouldRespondToBot(new_message) {
        try {
            const messages = this.agent.history.getHistory();
            messages.push({role: 'user', content: new_message});
            
            const prompt = await this.promptService.replaceStrings(
                this.profile.bot_responder, 
                messages
            );
            
            const res = await this.modelService.sendChatRequest([], prompt, {
                timeout: 10000 // 10 second timeout
            });
            
            return res.trim().toLowerCase() === 'respond';
        } catch (error) {
            console.error('Error in bot response decision:', error);
            return false; // Default to not responding on error
        }
    }
    
    /**
     * Process a goal setting prompt
     * @param {Array} messages - Conversation messages
     * @param {Object} last_goals - Previous goals
     * @returns {Promise<Object>} Generated goal
     */
    async promptGoalSetting(messages, last_goals) {
        try {
            const system_message = await this.promptService.prepareGoalSettingPrompt(messages, last_goals);
            
            let user_message = 'Use the below info to determine what goal to target next\n\n';
            user_message += '$LAST_GOALS\n$STATS\n$INVENTORY\n$CONVO';
            user_message = await this.promptService.replaceStrings(
                user_message, 
                messages, 
                null, 
                null, 
                last_goals
            );
            
            const user_messages = [{role: 'user', content: user_message}];
            const res = await this.modelService.sendChatRequest(user_messages, system_message, {
                timeout: 20000 // 20 second timeout
            });
            
            // Parse the response
            let goal = null;
            try {
                let data = res.split('```')[1].replace('json', '').trim();
                goal = JSON.parse(data);
            } catch (err) {
                console.error('Failed to parse goal:', res, err);
                return null;
            }
            
            // Validate goal structure
            if (!goal || !goal.name || !goal.quantity || isNaN(parseInt(goal.quantity))) {
                console.error('Invalid goal format:', res);
                return null;
            }
            
            goal.quantity = parseInt(goal.quantity);
            return goal;
        } catch (error) {
            console.error('Error in goal setting:', error);
            return null;
        }
    }
    
    /**
     * Store a memory in the memory system
     * @param {string} text - Memory text
     * @param {Object} metadata - Additional metadata
     * @returns {Promise<Object>} Stored memory
     */
    async storeMemory(text, metadata = {}) {
        return this.memoryService.storeMemory(text, metadata);
    }
    
    /**
     * Retrieve memories relevant to a query
     * @param {string} query - Search query
     * @param {number} limit - Maximum number of results
     * @param {Object} options - Additional options
     * @returns {Promise<string>} Formatted relevant memories
     */
    async retrieveRelevantMemories(query, limit = 10, options = {}) {
        return this.memoryService.retrieveRelevantMemories(query, limit, options);
    }
    
    /**
     * Add tags to a memory
     * @param {string} memoryId - Memory ID
     * @param {Array} tags - Tags to add
     * @returns {Promise<boolean>} Success status
     */
    async addTagsToMemory(memoryId, tags = []) {
        return this.memoryService.addTagsToMemory(memoryId, tags);
    }
    
    /**
     * Search memories by tags
     * @param {Array} tags - Tags to search for
     * @param {number} limit - Maximum number of results
     * @returns {Promise<string>} Formatted memories
     */
    async searchMemoriesByTags(tags = [], limit = 10) {
        return this.memoryService.searchMemoriesByTags(tags, limit);
    }
    
    /**
     * Get memory statistics
     * @returns {Promise<string>} Formatted statistics
     */
    async getMemoryStats() {
        return this.memoryService.getMemoryStats();
    }
    
    /**
     * Delete a memory
     * @param {string} memoryId - Memory ID
     * @returns {Promise<boolean>} Success status
     */
    async forgetMemory(memoryId) {
        return this.memoryService.forgetMemory(memoryId);
    }
    
    /**
     * Update memory importance
     * @param {string} memoryId - Memory ID
     * @param {string} importance - New importance value
     * @returns {Promise<boolean>} Success status
     */
    async updateMemoryImportance(memoryId, importance) {
        return this.memoryService.updateMemoryImportance(memoryId, importance);
    }
    
    /**
     * Process a message for memory storage
     * @param {string} message - Message to process
     * @param {string} importance - Importance level
     * @returns {Promise<void>}
     */
    async promptMemoryStorage(message, importance = "medium") {
        if (!this.memoryService) {
            console.warn('Cannot prompt memory storage: Memory system not available');
            return;
        }
        
        console.log(`Processing message for memory storage (importance: ${importance}): "${message.substring(0, 100)}..."`);
        
        try {
            if (!this.stateManager.transition(this.stateManager.STATES.PROCESSING_MEMORY)) {
                console.warn('Cannot store memory in current state:', this.stateManager.getCurrentState());
                return;
            }
            
            const prompt = await this.promptService.prepareMemoryStoragePrompt(message);
            
            console.log('Sending memory prompt for processing...');
            const memoryText = await this.modelService.sendChatRequest([], prompt, {
                timeout: 15000 // 15 second timeout
            });
            
            if (memoryText && memoryText.trim()) {
                console.log(`Generated memory text: "${memoryText.substring(0, 100)}..."`);
                const success = await this.storeMemory(memoryText.trim(), {
                    importance: importance,
                    source: "conversation"
                });
                
                if (success) {
                    console.log('Memory successfully stored in vector database');
                    this.eventBus.emit('memory:stored', { text: memoryText, importance });
                } else {
                    console.warn('Failed to store memory in vector database');
                }
            } else {
                console.warn('Generated empty memory text, nothing to store');
            }
            
            this.stateManager.transition(this.stateManager.STATES.IDLE);
        } catch (error) {
            console.error('Error in memory storage:', error);
            this.stateManager.transition(this.stateManager.STATES.ERROR, { error });
        }
    }
    
    /**
     * Get the current state of the prompter
     * @returns {string} Current state
     */
    getState() {
        return this.stateManager.getCurrentState();
    }
    
    /**
     * Check if the prompter is in an error state
     * @returns {boolean} Whether in error state
     */
    hasError() {
        return this.stateManager.getCurrentState() === this.stateManager.STATES.ERROR;
    }
    
    /**
     * Reset the prompter state and clear any errors
     */
    reset() {
        this.stateManager.reset();
        console.log('Prompter state reset');
    }
}
