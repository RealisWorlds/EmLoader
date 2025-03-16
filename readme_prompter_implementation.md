# Prompter.js Implementation Details

## System Design Overview

The enhanced prompter system implements a robust service-oriented architecture to resolve connection issues, improve error handling, and maintain high-quality memory retrieval with the custom 0.85 relevance threshold.

## Key Implementation Files

```
src/models/
├── enhanced_prompter.js      # Main implementation
├── prompter_adapter.js       # Backward compatibility adapter
└── services/
    ├── state_manager.js      # Finite state machine implementation
    ├── event_bus.js          # Event system for inter-service communication
    ├── model_service.js      # Language model connection management
    ├── memory_service.js     # Memory operations with custom relevance filtering
    └── prompt_service.js     # Prompt preparation and template management
```

## Code Structure

### EnhancedPrompter Class

```javascript
/**
 * Enhanced implementation of the Prompter with improved reliability
 */
export class EnhancedPrompter {
    constructor(agent, fp, memory) {
        // Initialize services
        this.stateManager = new StateManager();
        this.eventBus = new EventBus();
        this.modelService = new ModelService(profile);
        this.memoryService = new MemoryService(memory, vectorDbConfig);
        this.promptService = new PromptService(profile);
        
        // Setup and connect services
        this._setupEventListeners();
        this._initializeModels();
    }
    
    // API methods (unchanged from original Prompter)
    async promptConvo(messages) {...}
    async promptCoding(messages) {...}
    async promptMemSaving(to_summarize) {...}
    async promptShouldRespondToBot(new_message) {...}
    async promptGoalSetting(messages, last_goals) {...}
    
    // Memory system methods (with enhanced implementation)
    async storeMemory(text, metadata = {}) {...}
    async retrieveRelevantMemories(query, limit = 10, options = {}) {...}
    // ...additional memory methods
}
```

### StateManager Implementation

```javascript
/**
 * Manages state transitions using a finite state machine pattern
 */
export class StateManager {
    constructor() {
        this.STATES = {
            IDLE: 'idle',
            PROCESSING_CHAT: 'processing_chat',
            PROCESSING_CODE: 'processing_code',
            PROCESSING_MEMORY: 'processing_memory',
            ERROR: 'error',
            COOLDOWN: 'cooldown'
        };
        
        this.currentState = this.STATES.IDLE;
        this.transitionCallbacks = {};
        this.stateData = {};
    }
    
    getCurrentState() {...}
    transition(newState, data = {}) {...}
    onTransition(state, callback) {...}
    reset() {...}
}
```

### ModelService Implementation

```javascript
/**
 * Manages connections to language models with enhanced reliability
 */
export class ModelService {
    constructor(profile) {
        this.models = {};
        this.fallbacks = {};
        this.cooldown = profile.cooldown || 0;
        this.lastRequestTime = 0;
    }
    
    registerModel(name, model) {...}
    registerFallback(modelName, fallbackName) {...}
    
    async sendChatRequest(messages, prompt, options = {}) {
        // Enhanced with retry logic, fallbacks, and timeouts
        return this._sendRequest('chat', messages, prompt, options);
    }
    
    async sendCodeRequest(messages, prompt, options = {}) {
        // Enhanced with retry logic, fallbacks, and timeouts
        return this._sendRequest('code', messages, prompt, options);
    }
    
    async _sendRequest(modelType, messages, prompt, options = {}) {
        // Implementation with:
        // 1. Retry logic with exponential backoff
        // 2. Fallback to alternative models
        // 3. Request timeouts
        // 4. Cooldown management
    }
}
```

### MemoryService Implementation

```javascript
/**
 * Enhanced memory operations with caching and custom relevance threshold
 */
export class MemoryService {
    constructor(memoryManager, vectorDbConfig) {
        this.memoryManager = memoryManager;
        this.vectorDbConfig = vectorDbConfig;
        this.cache = new Map();
        this.cacheTTL = 60 * 1000; // 60 seconds
        this.minRelevanceScore = 0.85; // Custom high relevance threshold
    }
    
    initialize(MemoryManagerClass, embeddingModel) {
        // Initialize memory manager if not provided in constructor
        if (!this.memoryManager) {
            this.memoryManager = new MemoryManagerClass(embeddingModel, this.vectorDbConfig);
        }
    }
    
    async storeMemory(text, metadata = {}) {
        // Store memory and invalidate related cache entries
    }
    
    async retrieveRelevantMemories(query, limit = 10, options = {}) {
        // Check cache first
        // If not cached, perform vector search
        // Filter results by relevance score (>= 0.85)
        // Cache results for future queries
    }
    
    // Additional memory operations with enhanced implementation
}
```

### PromptService Implementation

```javascript
/**
 * Manages prompt preparation and template replacement
 */
export class PromptService {
    constructor(profile) {
        this.profile = profile;
        this.agent = null;
    }
    
    setAgent(agent) {
        this.agent = agent;
    }
    
    async prepareConversationPrompt(messages) {
        // Replace variables in system prompt
        // Include relevant high-quality memories (>= 0.85 relevance)
        // Format conversation history
    }
    
    async prepareCodePrompt(messages) {
        // Similar to conversation prompt but optimized for code generation
    }
    
    async prepareMemorySavingPrompt(to_summarize) {
        // Create prompt for memory summarization
    }
    
    async replaceStrings(template, messages, memories = null, skills = null, last_goals = null) {
        // Handle all variable replacements
        // Format memories, skills, and goals
    }
}
```

### EventBus Implementation

```javascript
/**
 * Simple publish/subscribe system for inter-service communication
 */
export class EventBus {
    constructor() {
        this.subscribers = {};
    }
    
    on(event, callback) {
        // Subscribe to an event
    }
    
    off(event, callback) {
        // Unsubscribe from an event
    }
    
    emit(event, data) {
        // Publish an event to all subscribers
    }
}
```

## Key Improvements

### 1. Memory Retrieval with High Relevance Standard

The memory retrieval system has been enhanced to maintain the custom 0.85 relevance threshold:

```javascript
// In MemoryService
async retrieveRelevantMemories(query, limit = 10, options = {}) {
    try {
        // Check cache first
        const cacheKey = `${query}:${limit}:${JSON.stringify(options)}`;
        const cachedResult = this.cache.get(cacheKey);
        if (cachedResult && Date.now() - cachedResult.timestamp < this.cacheTTL) {
            console.log('Using cached memory results for query:', query);
            return cachedResult.data;
        }
        
        // Get memories from vector store
        const memories = await this.memoryManager.search(query, limit * 2); // Get extra results for filtering
        
        // Apply custom high relevance threshold filter (0.85)
        const highQualityMemories = memories.filter(mem => mem.relevance >= this.minRelevanceScore);
        
        // Format memories for model consumption
        const formattedMemories = this._formatMemories(highQualityMemories.slice(0, limit));
        
        // Cache the results
        this.cache.set(cacheKey, {
            data: formattedMemories,
            timestamp: Date.now()
        });
        
        return formattedMemories;
    } catch (error) {
        console.error('Error retrieving memories:', error);
        return "No relevant memories found.";
    }
}
```

### 2. Error Handling with Retry Logic

```javascript
// In ModelService
async _sendRequest(modelType, messages, prompt, options = {}) {
    const model = this.models[modelType];
    if (!model) {
        throw new Error(`No model registered for type: ${modelType}`);
    }
    
    const { timeout = 30000, maxRetries = 2, backoffFactor = 1.5 } = options;
    let attempt = 0;
    
    while (attempt <= maxRetries) {
        try {
            // Apply cooldown if needed
            const now = Date.now();
            const timeSinceLastRequest = now - this.lastRequestTime;
            if (timeSinceLastRequest < this.cooldown) {
                const waitTime = this.cooldown - timeSinceLastRequest;
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }
            
            // Send request with timeout
            const requestPromise = model.sendRequest(messages, prompt);
            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Request timed out')), timeout));
            
            const response = await Promise.race([requestPromise, timeoutPromise]);
            this.lastRequestTime = Date.now();
            return response;
        } catch (error) {
            attempt++;
            console.warn(`Request failed (attempt ${attempt}/${maxRetries + 1}):`, error.message);
            
            if (attempt > maxRetries) {
                // Try fallback model if available
                const fallbackModelType = this.fallbacks[modelType];
                if (fallbackModelType && this.models[fallbackModelType]) {
                    console.log(`Trying fallback model: ${fallbackModelType}`);
                    try {
                        const fallbackModel = this.models[fallbackModelType];
                        const response = await fallbackModel.sendRequest(messages, prompt);
                        return response;
                    } catch (fallbackError) {
                        console.error('Fallback model also failed:', fallbackError);
                        throw error; // Throw original error
                    }
                }
                throw error;
            }
            
            // Exponential backoff
            const delay = Math.pow(backoffFactor, attempt) * 1000;
            console.log(`Retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}
```

### 3. State Management for Process Control

```javascript
// In EnhancedPrompter.promptConvo
async promptConvo(messages) {
    // Record message time to handle race conditions
    this.most_recent_msg_time = Date.now();
    let current_msg_time = this.most_recent_msg_time;
    
    // Check if we can transition to processing state
    if (!this.stateManager.transition(this.stateManager.STATES.PROCESSING_CHAT)) {
        console.warn('Cannot process conversation in current state:', this.stateManager.getCurrentState());
        return '';
    }
    
    try {
        // Make sure we're still processing the latest message
        if (current_msg_time !== this.most_recent_msg_time) {
            console.log('Received newer message while generating, discarding old response');
            this.stateManager.transition(this.stateManager.STATES.IDLE);
            return '';
        }
        
        // Prepare the prompt and send request
        const prompt = await this.promptService.prepareConversationPrompt(messages);
        const generation = await this.modelService.sendChatRequest(messages, prompt, {
            timeout: 30000, // 30 second timeout
            maxRetries: 2,
            backoffFactor: 1.5
        });
        
        // Final check for newer messages
        if (current_msg_time !== this.most_recent_msg_time) {
            console.log('Received new message while generating, discarding old response');
            this.stateManager.transition(this.stateManager.STATES.IDLE);
            return '';
        }
        
        // Success
        this.stateManager.transition(this.stateManager.STATES.IDLE);
        return generation;
    } catch (error) {
        console.error('Error in conversation prompt:', error);
        this.stateManager.transition(this.stateManager.STATES.ERROR, { error });
        return '';
    }
}
```

## Usage Examples

### Basic Initialization

```javascript
// Import with adapter for gradual migration
import { createPrompter } from './src/models/prompter_adapter.js';

// Create prompter with agent and profile path
const prompter = createPrompter(agent, './profiles/myagent.json');

// Initialize examples
await prompter.initExamples();
```

### Conversation and Code Generation

```javascript
// Generate conversation response
const response = await prompter.promptConvo(messages);

// Generate code
const code = await prompter.promptCoding(codeMessages);
```

### Memory Operations

```javascript
// Store a memory
await prompter.storeMemory('Important information about the world', {
    importance: 'high',
    source: 'observation'
});

// Retrieve relevant memories (with 0.85 relevance threshold)
const memories = await prompter.retrieveRelevantMemories('Current situation query');
```

## Performance Monitoring

Monitor the system's health with:

```javascript
// Check current state
const state = prompter.getState();
console.log(`Current state: ${state}`);

// Check for errors
if (prompter.hasError()) {
    console.warn('Prompter is in error state');
    prompter.reset(); // Attempt recovery
}
```

## Conclusion

This enhanced implementation of the prompter system provides robust error handling, efficient state management, and improved memory operations while maintaining the custom high relevance threshold of 0.85 for memory retrieval. The service-oriented architecture makes the system more resilient to failures and easier to extend with new capabilities.
