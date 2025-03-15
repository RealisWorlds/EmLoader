import { v4 as uuidv4 } from 'uuid';
import { QdrantClient } from '@qdrant/js-client-rest';
import { hasKey } from '../utils/keys.js';

/**
 * Memory Management System
 * Handles storage, retrieval, and management of agent memories
 */
export class MemoryManager {
    /**
     * Create a memory manager
     * @param {Object} embedding_model_or_agent - The agent this memory manager belongs to or directly the embedding model
     * @param {Object|string} vectorDbUrl_or_embedding_model - The embedding model or the URL of the vector database
     * @param {Object} options - Additional options
     * @param {string} options.collectionName - The name of the collection to use
     * @param {number} options.vectorSize - The size of the vectors
     */
    constructor(embedding_model_or_agent, vectorDbUrl_or_embedding_model, options = {}) {
        // Support the old constructor pattern where the first argument is an agent
        if (embedding_model_or_agent && embedding_model_or_agent.prompter) {
            // Old pattern: constructor(agent, embedding_model)
            const agent = embedding_model_or_agent;
            const embedding_model = vectorDbUrl_or_embedding_model;
            
            // Store agent reference for backward compatibility
            this.agent = agent;
            
            // Extract configuration from agent's profile
            const profile = agent.prompter?.profile || {};
            const vectorDbConfig = profile.vectorDb || {};
            
            // Use values from profile or fallback to defaults
            this.embedding_model = embedding_model;
            this.vectorDbUrl = vectorDbConfig.url || 'http://localhost:6333';
            this.collectionName = vectorDbConfig.collectionName || `${agent.name}_memories`;
            this.vectorSize = vectorDbConfig.vectorSize || null;
            this._isVectorMemoryOperation = false;
            
            console.log(`MemoryManager initialized with collection name: ${this.collectionName} (agent-based pattern)`);
        } else {
            // New pattern: constructor(embedding_model, vectorDbUrl, options)
            this.agent = null; // No agent in the new pattern
            this.embedding_model = embedding_model_or_agent;
            this.vectorDbUrl = vectorDbUrl_or_embedding_model || 'http://localhost:6333';
            this.collectionName = options.collectionName || 'default_memory';
            this.vectorSize = options.vectorSize || null;
            this._isVectorMemoryOperation = false;

            console.log(`MemoryManager initialized with collection name: ${this.collectionName}`);
        }
        
        // Initialize the vector client
        this.vectorClient = new QdrantClient({ 
            url: this.vectorDbUrl 
        });
        
        // Initialize the vector database
        this.initVectorMemory().catch(err => {
            console.error('Error during memory system initialization:', err);
        });
    }

    /**
     * Initialize the vector memory database
     * @returns {Promise<boolean>} Success status
     */
    async initVectorMemory() {
        try {
            if (!this.embedding_model) {
                console.warn('No embedding model available for vector memory');
                return false;
            }
            
            // Verify connection to Qdrant
            console.log(`Testing connection to Qdrant vector database...`);
            await this.verifyVectorDbConnection();

            // Ensure we have a valid collection name
            if (!this.collectionName) {
                console.warn('No collection name specified, using default');
                this.collectionName = 'default_memory';
            }

            // Get embedding dimension from model or use predefined size from profile
            let embeddingSize = this.vectorSize;
            if (!embeddingSize) {
                try {
                    const sampleEmbedding = await this.getEmbedding('Sample text for dimension check');
                    embeddingSize = sampleEmbedding.length;
                } catch (err) {
                    embeddingSize = 1536; // Default to 1536 if we can't determine vector size
                    console.warn('Could not determine embedding dimension, using default:', embeddingSize);
                }
            }
            
            console.log(`Using ${embeddingSize}-dimensional embeddings for memory storage`);
            
            // Check if collection exists and create if it doesn't
            try {
                // First check if the collection exists by listing all collections
                const collections = await this.vectorClient.getCollections();
                console.log('Available collections:', collections.collections.map(c => c.name).join(', '));
                
                const collectionExists = collections.collections.some(
                    collection => collection.name === this.collectionName
                );
                
                if (!collectionExists) {
                    console.log(`Creating memory collection ${this.collectionName}...`);
                    try {
                        // Create the collection with standard API
                        await this.vectorClient.createCollection(this.collectionName, {
                            vectors: {
                                size: embeddingSize,
                                distance: "Cosine"
                            }
                        });
                        console.log(`Memory collection ${this.collectionName} created`);
                    } catch (createError) {
                        // Try alternative API format as fallback for older versions
                        try {
                            await this.vectorClient.createCollection({
                                collection_name: this.collectionName,
                                vectors: {
                                    size: embeddingSize,
                                    distance: "Cosine"
                                }
                            });
                            console.log(`Memory collection ${this.collectionName} created (using alternative API format)`);
                        } catch (altCreateError) {
                            console.error('Failed to create collection with both API formats:', altCreateError);
                            throw altCreateError;
                        }
                    }
                } else {
                    console.log(`Memory collection ${this.collectionName} already exists`);
                }
            } catch (error) {
                console.error('Error checking/creating collection:', error);
                throw error;
            }
            
            // Save the vector size for future reference
            this.vectorSize = embeddingSize;
            
            return true;
        } catch (error) {
            console.error('Failed to initialize vector memory:', error);
            return false;
        }
    }

    /**
     * Verify connection to Qdrant vector database
     * @returns {Promise<boolean>} - True if connection successful
     */
    async verifyVectorDbConnection() {
        try {
            console.log('Testing connection to Qdrant vector database...');
            
            // List collections to verify connectivity (using getCollections method)
            const collectionsResponse = await this.vectorClient.getCollections();
            console.log('Successfully connected to Qdrant.');
            
            if (collectionsResponse && Array.isArray(collectionsResponse.collections)) {
                const collectionNames = collectionsResponse.collections.map(c => c.name);
                console.log('Available collections:', collectionNames.join(', ') || 'None');
            } else {
                console.log('No collections found or unexpected response format');
            }
            
            // Verify credentials and API key setup if using OpenAI embeddings
            const embeddingModelType = this.embedding_model?.constructor?.name;
            if (embeddingModelType === 'GPT' && !hasKey('OPENAI_API_KEY')) {
                console.error('WARNING: Using OpenAI embeddings but OPENAI_API_KEY is not set!');
                console.error('Memory collections will fail to create without a valid API key.');
                return false;
            }
            
            return true;
        } catch (error) {
            console.error('Failed to connect to Qdrant vector database:', error);
            console.error('Please check that Qdrant is running and accessible at:', this.vectorDbUrl);
            return false;
        }
    }

    /**
     * Generate an embedding vector for text
     * @param {string} text - Text to embed
     * @returns {Promise<number[]>} - Embedding vector or null if not available
     */
    async getEmbedding(text) {
        if (!this.embedding_model) {
            console.warn('No embedding model available for vector memory');
            return null;
        }
        
        // Set flag to track vector memory operations
        this._isVectorMemoryOperation = true;
        
        try {
            console.log('Generating embedding using', this.embedding_model.constructor.name);
            
            // Try different embedding methods based on model type
            let embedding = null;
            
            // First try getEmbedding (our standard method)
            if (typeof this.embedding_model.getEmbedding === 'function') {
                console.log('Using getEmbedding method');
                embedding = await this.embedding_model.getEmbedding(text);
            } 
            // Fall back to embed method
            else if (typeof this.embedding_model.embed === 'function') {
                console.log('Using embed method');
                embedding = await this.embedding_model.embed(text);
            }
            // Fall back to createEmbedding method (for some API clients)
            else if (typeof this.embedding_model.createEmbedding === 'function') {
                console.log('Using createEmbedding method');
                embedding = await this.embedding_model.createEmbedding(text);
            }
            
            if (!embedding) {
                throw new Error('No valid embedding method available on model');
            }
            
            console.log(`Successfully generated embedding (${embedding.length} dimensions)`);
            return embedding;
        } catch (error) {
            console.error('Error generating embedding:', error);
            
            // If error contains response data, log it for debugging
            if (error.response) {
                console.error('Error response:', error.response.status, error.response.data);
            }
            
            // Reset flag
            this._isVectorMemoryOperation = false;
            
            // Show guidance message
            console.error('Please check that your API keys are correctly configured in keys.json or environment variables.');
            console.error('For OpenAI, ensure OPENAI_API_KEY is set correctly.');
            
            // Validate API key
            if (!hasKey('OPENAI_API_KEY')) {
                console.error('OPENAI_API_KEY is not set. Please set it in keys.json or environment variables.');
            }
            
            return null;
        } finally {
            // Always reset the flag when done to prevent side effects
            this._isVectorMemoryOperation = false;
        }
    }

    /**
     * Store a memory in the vector database
     * @param {string} text - Memory text to store
     * @param {Object} metadata - Additional metadata for the memory
     * @returns {Promise<boolean>} - Success status
     */
    async storeMemory(text, metadata = {}) {
        if (!this.vectorClient || !this.embedding_model) {
            console.warn('Cannot store memory: Vector client or embedding model not available');
            return false;
        }
        
        // First make sure the collection exists
        try {
            await this.ensureCollectionExists();
        } catch (err) {
            console.error('Cannot store memory: Failed to ensure collection exists:', err);
            return false;
        }
        
        try {
            // Generate a unique ID for this memory
            const id = uuidv4();
            
            // Generate embedding
            console.log('Generating memory embedding...');
            const embedding = await this.getEmbedding(text);
            
            if (!embedding) {
                console.warn('Failed to generate embedding for memory');
                return false;
            }
            
            console.log(`Generated memory embedding (${embedding.length} dimensions)`);
            
            // Store memory with enhanced structured metadata
            const point = {
                id: id,
                vector: embedding,
                payload: {
                    text: text,
                    timestamp: new Date().toISOString(),
                    last_accessed: new Date().toISOString(),
                    access_count: 0,
                    type: metadata.type || 'general',
                    importance: metadata.importance || 'medium',
                    source: metadata.source || 'unknown',
                    entities: metadata.entities || [],
                    context: metadata.context || {},
                    related_memories: metadata.related_memories || [],
                    tags: metadata.tags || []
                }
            };
            
            // Log the point we're inserting (for debugging)
            console.log(`Storing memory to collection "${this.collectionName}"...`);
            console.log('Memory ID:', id);
            console.log('Memory text:', text.substring(0, 100) + (text.length > 100 ? '...' : ''));
            
            // Try to upsert with all known API formats
            let success = false;
            
            // Format 1: Standard REST API format (newer versions)
            try {
                await this.vectorClient.upsert(this.collectionName, {
                    points: [point]
                });
                console.log(`Memory stored successfully with ID ${id}`);
                success = true;
            } catch (error1) {
                console.warn('First upsert attempt failed:', error1.message);
                
                // Format 2: Object-based format (some versions)
                try {
                    await this.vectorClient.upsert({
                        collection_name: this.collectionName,
                        points: [point]
                    });
                    console.log(`Memory stored successfully with ID ${id} (format 2)`);
                    success = true;
                } catch (error2) {
                    console.warn('Second upsert attempt failed:', error2.message);
                    
                    // Format 3: Using client.points() (older versions)
                    try {
                        const pointsInterface = this.vectorClient.points(this.collectionName);
                        await pointsInterface.upsert([point]);
                        console.log(`Memory stored successfully with ID ${id} (format 3)`);
                        success = true;
                    } catch (error3) {
                        console.error('All upsert attempts failed. Details:', {
                            error1: error1.message,
                            error2: error2.message,
                            error3: error3.message
                        });
                    }
                }
            }
            
            return success;
        } catch (error) {
            console.error('Error storing memory:', error);
            return false;
        }
    }
    
    /**
     * Ensure the collection exists before trying to use it
     * @private
     */
    async ensureCollectionExists() {
        try {
            // Check if collection exists
            const collections = await this.vectorClient.getCollections();
            const collectionExists = collections.collections.some(
                collection => collection.name === this.collectionName
            );
            
            if (!collectionExists) {
                // Determine vector size if not already set
                if (!this.vectorSize) {
                    try {
                        const sampleEmbedding = await this.getEmbedding('Sample text for dimension check');
                        this.vectorSize = sampleEmbedding.length;
                        console.log(`Determined vector size: ${this.vectorSize} dimensions`);
                    } catch (err) {
                        console.warn('Could not determine embedding dimension, using default: 1536');
                        this.vectorSize = 1536;
                    }
                }
                
                console.log(`Creating collection "${this.collectionName}" with ${this.vectorSize} dimensions...`);
                
                // Try different API formats for collection creation
                try {
                    await this.vectorClient.createCollection(this.collectionName, {
                        vectors: {
                            size: this.vectorSize,
                            distance: "Cosine"
                        }
                    });
                    console.log(`Collection "${this.collectionName}" created successfully`);
                } catch (err1) {
                    console.log('First creation attempt failed, trying alternative API format:', err1.message);
                    
                    try {
                        await this.vectorClient.createCollection({
                            collection_name: this.collectionName,
                            vectors: {
                                size: this.vectorSize,
                                distance: "Cosine"
                            }
                        });
                        console.log(`Collection "${this.collectionName}" created successfully (format 2)`);
                    } catch (err2) {
                        console.error('Failed to create collection:', err2.message);
                        throw new Error('Could not create collection');
                    }
                }
            } else {
                console.log(`Collection "${this.collectionName}" already exists`);
            }
            
            return true;
        } catch (err) {
            console.error('Error ensuring collection exists:', err);
            throw err;
        }
    }

    /**
     * Retrieve memories relevant to a query
     * @param {string} query - Query to search for
     * @param {number} limit - Maximum number of results to return
     * @param {Object} options - Filter options
     * @param {number} options.relevanceThreshold - Minimum relevance score (0-1) for memories to be included
     * @param {number} options.fallbackThreshold - Lower threshold to use if no memories meet the primary threshold
     * @param {string[]} options.filterTags - Only include memories with these tags
     * @param {string} options.filterType - Only include memories of this type
     * @returns {string} - Formatted memory results
     */
    async retrieveRelevantMemories(query, limit = 10, options = {}) {
        if (!this.vectorClient || !this.embedding_model) {
            console.warn('Cannot retrieve memories: Vector client or embedding model not available');
            return "No memory system available.";
        }
        
        // Set default thresholds - use 0.45 as primary threshold as per user preference
        const primaryThreshold = options.relevanceThreshold || 0.45;  // High threshold by default (user preference)
        const fallbackThreshold = options.fallbackThreshold || 0.70;  // Lower threshold as fallback
        
        try {
            console.log(`Retrieving memories relevant to: "${query.substring(0, 50)}..."`);
            console.log(`Using collection: "${this.collectionName}"`);
            
            // Generate embedding for query
            console.log('Generating query embedding...');
            const queryEmbedding = await this.getEmbedding(query);
            
            if (!queryEmbedding) {
                console.error('Failed to generate embedding for query');
                return "Error retrieving long-term memories.";
            }
            
            console.log(`Generated query embedding (${queryEmbedding.length} dimensions)`);
            
            // Set up search filters based on options
            const filter = {};
            if (options.filterTags && options.filterTags.length > 0) {
                filter['metadata.tags'] = { $in: options.filterTags };
            }
            if (options.filterType) {
                filter['metadata.type'] = options.filterType;
            }
            
            // Search for memories with primary threshold
            console.log(`Searching collection "${this.collectionName}" for ${limit} relevant memories...`);
            console.log(`Using primary relevance threshold: ${primaryThreshold}`);
            
            // Get information about the collection
            try {
                const collectionInfo = await this.vectorClient.getCollection(this.collectionName);
                console.log(`Collection status: ${collectionInfo.status}, points: ${collectionInfo.points_count}`);
                
                if (collectionInfo.points_count === 0) {
                    return "No memories found in collection.";
                }
            } catch (err) {
                console.warn("Could not get collection info:", err.message);
            }
            
            // Try all possible search API formats
            let searchResults = null;
            let searchError = null;
            
            // Format 1: Standard API (collection name first, then params)
            try {
                searchResults = await this.vectorClient.search(this.collectionName, {
                    vector: queryEmbedding,
                    limit: limit * 2, 
                    filter: Object.keys(filter).length > 0 ? filter : undefined,
                    with_payload: true,
                    score_threshold: fallbackThreshold  // Use the lower threshold here and filter later
                });
                console.log(`Search successful using format 1, found ${searchResults.length} results`);
            } catch (error1) {
                console.warn('Search format 1 failed:', error1.message);
                searchError = error1;
                
                // Format 2: Object-based API (all params in one object)
                try {
                    searchResults = await this.vectorClient.search({
                        collection_name: this.collectionName,
                        vector: queryEmbedding,
                        limit: limit * 2,
                        filter: Object.keys(filter).length > 0 ? filter : undefined,
                        with_payload: true,
                        score_threshold: fallbackThreshold
                    });
                    console.log(`Search successful using format 2, found ${searchResults.length} results`);
                } catch (error2) {
                    console.warn('Search format 2 failed:', error2.message);
                    
                    // Format 3: Using collection interface
                    try {
                        const collectionInterface = this.vectorClient.collection(this.collectionName);
                        searchResults = await collectionInterface.search({
                            vector: queryEmbedding,
                            limit: limit * 2,
                            filter: Object.keys(filter).length > 0 ? filter : undefined,
                            with_payload: true,
                            score_threshold: fallbackThreshold
                        });
                        console.log(`Search successful using format 3, found ${searchResults.length} results`);
                    } catch (error3) {
                        console.error('All search formats failed. Details:', {
                            error1: error1.message,
                            error2: error2.message,
                            error3: error3.message
                        });
                        return "Error retrieving memories: " + error3.message;
                    }
                }
            }
            
            // Check for valid search results
            if (!searchResults || !Array.isArray(searchResults)) {
                console.warn('No valid search results returned');
                return "No relevant memories found.";
            }

            console.log(`Search returned ${searchResults.length} results with scores:`, 
                searchResults.map(r => Math.round(r.score * 100) + '%').join(', '));
            
            // Apply two-tier threshold strategy:
            // 1. First try with high relevance threshold (primaryThreshold)
            let highRelevanceResults = searchResults.filter(result => result.score >= primaryThreshold);
            
            // 2. If no high-relevance results, fall back to the lower threshold
            let finalResults = highRelevanceResults;
            
            if (highRelevanceResults.length === 0) {
                console.log(`No memories found with primary threshold ${primaryThreshold}. ` +
                           `Using fallback threshold: ${fallbackThreshold}`);
                finalResults = searchResults.filter(result => result.score >= fallbackThreshold);
            }
            
            // Limit results to the requested number
            finalResults = finalResults.slice(0, limit);
            
            // Format and return memory results
            if (finalResults.length === 0) {
                return "No relevant memories found.";
            }
            
            // Update access info for retrieved memories
            this.updateMemoryAccessInfo(finalResults.map(r => r.id));
            
            // Format the results
            let formattedResults = "Long-term memories:\n\n";
            
            for (let i = 0; i < finalResults.length; i++) {
                const result = finalResults[i];
                const memory = result.payload;
                const relevancePercent = Math.round(result.score * 100);
                
                formattedResults += `[Memory ${i+1}] (Relevance: ${relevancePercent}%)\n`;
                formattedResults += `${memory.text}\n\n`;
            }
            
            console.log(`Retrieved ${finalResults.length} memories ` +
                      `with scores ranging from ${Math.round(finalResults[finalResults.length-1]?.score * 100)}% ` +
                      `to ${Math.round(finalResults[0]?.score * 100)}%`);
            
            return formattedResults;
        } catch (error) {
            console.error('Error retrieving memories:', error);
            return "Error retrieving long-term memories.";
        }
    }

    /**
     * Update memory access metadata
     * @param {Array<string>} memoryIds - IDs of memories to update
     * @private
     */
    async _updateMemoryAccessMetadata(memoryIds) {
        if (!this.vectorClient || !memoryIds || memoryIds.length === 0) {
            return;
        }
        
        try {
            console.log(`Updating access metadata for ${memoryIds.length} memories`);
            const now = new Date().toISOString();
            
            for (const id of memoryIds) {
                try {
                    const point = await this.vectorClient.retrieve(this.collectionName, { ids: [id] });
                    
                    if (point && point.length > 0) {
                        const memory = point[0].payload;
                        const accessCount = (memory.access_count || 0) + 1;
                        
                        await this.vectorClient.setPayload(this.collectionName, {
                            points: [id],
                            payload: {
                                last_accessed: now,
                                access_count: accessCount
                            }
                        });
                    }
                } catch (err) {
                    console.warn(`Failed to update memory ${id} access metadata:`, err.message);
                }
            }
        } catch (error) {
            console.warn('Error updating memory access metadata:', error);
        }
    }

    /**
     * Update access information for retrieved memories
     * @param {Array<string>} memoryIds - Array of memory IDs to update
     * @returns {Promise<void>}
     */
    async updateMemoryAccessInfo(memoryIds) {
        if (!this.vectorClient || !memoryIds || memoryIds.length === 0) {
            return;
        }
        
        const now = new Date().toISOString();
        
        try {
            // Update each memory's access information
            for (const id of memoryIds) {
                try {
                    // Get current payload for this memory
                    let point = null;
                    
                    // Try different API formats to get points
                    try {
                        // Format 1: Direct points method
                        const response = await this.vectorClient.getPoints(this.collectionName, {
                            ids: [id],
                            with_payload: true
                        });
                        if (response?.points?.[0]) {
                            point = response.points[0];
                        }
                    } catch (err1) {
                        try {
                            // Format 2: Object-based API
                            const response = await this.vectorClient.getPoints({
                                collection_name: this.collectionName,
                                ids: [id],
                                with_payload: true
                            });
                            if (response?.points?.[0]) {
                                point = response.points[0];
                            }
                        } catch (err2) {
                            try {
                                // Format 3: Using collection interface
                                const collection = this.vectorClient.collection(this.collectionName);
                                const response = await collection.retrieve([id], { with_payload: true });
                                if (response?.[0]) {
                                    point = response[0];
                                }
                            } catch (err3) {
                                console.warn(`All getPoints methods failed for memory ${id}:`, 
                                    { error1: err1.message, error2: err2.message, error3: err3.message });
                                // Skip updating this point
                                continue;
                            }
                        }
                    }
                    
                    if (!point || !point.payload) {
                        console.warn(`Memory ${id} not found or has no payload, cannot update access info`);
                        continue;
                    }
                    
                    // Update access information
                    const payload = point.payload;
                    const newPayload = {
                        ...payload,
                        last_accessed: now,
                        access_count: (payload.access_count || 0) + 1
                    };
                    
                    // Try different API formats to update the point
                    let updated = false;
                    
                    try {
                        // Format 1: Collection name first, then params
                        await this.vectorClient.setPayload(this.collectionName, {
                            points: [id],
                            payload: newPayload
                        });
                        updated = true;
                    } catch (err1) {
                        try {
                            // Format 2: Object-based API
                            await this.vectorClient.setPayload({
                                collection_name: this.collectionName,
                                points: [id],
                                payload: newPayload
                            });
                            updated = true;
                        } catch (err2) {
                            try {
                                // Format 3: Using collection interface
                                const collection = this.vectorClient.collection(this.collectionName);
                                await collection.updatePayload([id], newPayload);
                                updated = true;
                            } catch (err3) {
                                console.warn(`All payload update methods failed for memory ${id}:`, 
                                    { error1: err1.message, error2: err2.message, error3: err3.message });
                            }
                        }
                    }
                    
                    if (updated) {
                        console.log(`Updated access info for memory ${id}`);
                    }
                } catch (err) {
                    console.warn(`Failed to update access info for memory ${id}:`, err.message);
                }
            }
        } catch (err) {
            console.error('Error updating memory access information:', err);
        }
    }

    /**
     * Format a single structured memory
     * @param {Object} result - Memory search result
     * @param {boolean} isSingleResult - Whether this is a single result being shown alone
     * @returns {string} - Formatted memory text
     */
    _formatStructuredMemory(result, isSingleResult = false) {
        if (!result || !result.payload || !result.payload.text) {
            return "Error: Malformed memory";
        }
        
        const memory = result.payload;
        let timestamp;
        try {
            timestamp = new Date(memory.timestamp).toLocaleString();
        } catch (e) {
            timestamp = "Unknown time";
        }
        const score = result.score.toFixed(2);
        
        let formatted = isSingleResult ? "Most relevant memory:\n\n" : "";
        
        // Create a structured format with clear sections
        formatted += `Memory (relevance: ${score}):\n${memory.text}\n`;
        formatted += `Type: ${memory.type || 'general'}\n`;
        formatted += `Importance: ${memory.importance || 'medium'}\n`;
        formatted += `Timestamp: ${timestamp}\n`;
        
        // Add entities if available
        if (memory.entities && memory.entities.length > 0) {
            formatted += `Entities: ${memory.entities.join(", ")}\n`;
        }
        
        // Add tags if available
        if (memory.tags && memory.tags.length > 0) {
            formatted += `Tags: ${memory.tags.join(", ")}\n`;
        }
        
        // Add context if available
        if (memory.context && Object.keys(memory.context).length > 0) {
            formatted += "Context:\n";
            for (const [key, value] of Object.entries(memory.context)) {
                formatted += `- ${key}: ${value}\n`;
            }
        }
        
        formatted += "\n";
        return formatted;
    }

    /**
     * Format multiple structured memories
     * @param {Array<Object>} results - Memory search results
     * @returns {string} - Formatted memories text
     */
    _formatStructuredMemories(results) {
        if (!results || results.length === 0) {
            return "No memories to display.";
        }
        
        let formattedResults = "Relevant long-term memories:\n\n";
        
        // Add a try-catch block around the forEach to prevent disconnects on memory formatting errors
        try {
            results.forEach((result, index) => {
                if (!result || !result.payload || !result.payload.text) {
                    console.warn(`Skipping malformed memory result at index ${index}`);
                    return; // Skip this iteration
                }
                
                const memory = result.payload;
                let timestamp;
                try {
                    timestamp = new Date(memory.timestamp).toLocaleString();
                } catch (e) {
                    timestamp = "Unknown time";
                }
                const score = result.score.toFixed(2);
                
                console.log(`Memory ${index + 1}: Score: ${score}, Type: ${memory.type || 'general'}, Text: "${memory.text.substring(0, 50)}..."`);
                
                // Create a structured format with clear sections
                formattedResults += `Memory ${index + 1} (relevance: ${score}):\n${memory.text}\n`;
                formattedResults += `Type: ${memory.type || 'general'}\n`;
                formattedResults += `Importance: ${memory.importance || 'medium'}\n`;
                formattedResults += `Timestamp: ${timestamp}\n`;
                
                // Add entities if available
                if (memory.entities && memory.entities.length > 0) {
                    formattedResults += `Entities: ${memory.entities.join(", ")}\n`;
                }
                
                // Add tags if available
                if (memory.tags && memory.tags.length > 0) {
                    formattedResults += `Tags: ${memory.tags.join(", ")}\n`;
                }
                
                // Add context if available
                if (memory.context && Object.keys(memory.context).length > 0) {
                    formattedResults += "Context:\n";
                    for (const [key, value] of Object.entries(memory.context)) {
                        formattedResults += `- ${key}: ${value}\n`;
                    }
                }
                
                formattedResults += "\n";
            });
        } catch (formattingError) {
            console.error('Error formatting memory results:', formattingError);
            // Try to return a simpler format if there's an error
            return "Found relevant memories but encountered an error during formatting. Please try again.";
        }
        
        return formattedResults;
    }

    /**
     * Create payload index for faster filtering
     * @returns {Promise<boolean>} - True if successful
     */
    async createPayloadIndex() {
        if (!this.vectorClient || !this.collectionName) {
            return false;
        }
        
        try {
            // Create index on metadata fields that are often used for filtering
            const fieldsToIndex = ['type', 'source', 'importance', 'timestamp'];
            
            for (const field of fieldsToIndex) {
                try {
                    await this.vectorClient.createPayloadIndex(this.collectionName, {
                        field_name: `metadata.${field}`,
                        field_schema: 'keyword'
                    });
                    console.log(`Created payload index for metadata.${field}`);
                } catch (err) {
                    // Try alternative API format
                    try {
                        await this.vectorClient.createPayloadIndex({
                            collection_name: this.collectionName,
                            field_name: `metadata.${field}`,
                            field_schema: 'keyword'
                        });
                        console.log(`Created payload index for metadata.${field} (alternative API)`);
                    } catch (altErr) {
                        // Ignore individual field errors, just continue with others
                        console.warn(`Could not create index for metadata.${field}: ${altErr.message}`);
                    }
                }
            }
            return true;
        } catch (err) {
            console.warn(`Could not create payload indexes: ${err.message}`);
            return false;
        }
    }

    /**
     * Method to add tags to an existing memory
     * @param {string} memoryId - ID of memory to add tags to
     * @param {Array<string>} tags - Tags to add
     * @returns {boolean} - Success or failure
     */
    async addTagsToMemory(memoryId, tags = []) {
        if (!this.vectorClient || !Array.isArray(tags) || tags.length === 0) {
            return false;
        }
        
        try {
            // Retrieve the memory
            const points = await this.vectorClient.retrieve(this.collectionName, {
                ids: [memoryId],
                with_payload: true,
                with_vectors: false
            });
            
            if (!points || points.length === 0) {
                console.warn(`Memory with ID ${memoryId} not found.`);
                return false;
            }
            
            const point = points[0];
            const payload = point.payload;
            
            // Add new tags while avoiding duplicates
            if (!payload.tags) {
                payload.tags = [];
            }
            
            const uniqueTags = [...new Set([...payload.tags, ...tags])];
            payload.tags = uniqueTags;
            
            // Update the memory with new tags
            await this.vectorClient.updatePayload(this.collectionName, {
                points: [{ id: memoryId, payload: payload }]
            });
            
            console.log(`Added tags ${tags.join(', ')} to memory ${memoryId}`);
            return true;
        } catch (error) {
            console.error('Error adding tags to memory:', error);
            return false;
        }
    }
    
    /**
     * Method to search memories by tags
     * @param {Array<string>} tags - Tags to search for
     * @param {number} limit - Maximum number of results to return
     * @returns {string} - Formatted memory results
     */
    async searchMemoriesByTags(tags = [], limit = 10) {
        if (!this.vectorClient || !Array.isArray(tags) || tags.length === 0) {
            return "No tags specified for memory search.";
        }
        
        try {
            // Build filter to search for memories with any of the specified tags
            const filter = {
                should: tags.map(tag => ({
                    key: 'tags',
                    match: { value: tag }
                })),
                min_should_match: 1 // At least one tag should match
            };
            
            // Search for memories with the specified tags
            const searchResults = await this.vectorClient.scroll({
                collection_name: this.collectionName,
                limit: limit,
                filter: filter,
                with_payload: true,
                with_vectors: false
            });
            
            if (!searchResults || !searchResults.points || searchResults.points.length === 0) {
                return `No memories found with tags: ${tags.join(', ')}`;
            }
            
            // Format and return the found memories
            return this._formatStructuredMemories(
                searchResults.points.map(point => ({
                    id: point.id,
                    score: 1.0, // No relevance score in tag-based search
                    payload: point.payload
                }))
            );
        } catch (error) {
            console.error('Error searching memories by tags:', error);
            return "Error searching memories by tags.";
        }
    }
    
    /**
     * Method to get memory statistics
     * @returns {string} - Formatted memory statistics
     */
    async getMemoryStats() {
        if (!this.vectorClient) {
            return "Memory system not available.";
        }
        
        try {
            // Get collection info to get count of memories
            const collectionInfo = await this.vectorClient.getCollection(this.collectionName);
            
            if (!collectionInfo) {
                return "Unable to retrieve memory statistics.";
            }
            
            // Sample some recent memories to analyze
            const recentMemories = await this.vectorClient.scroll({
                collection_name: this.collectionName,
                limit: 100,
                with_payload: true,
                with_vectors: false
            });
            
            // Count by type and importance
            const typeCount = {};
            const importanceCount = {};
            let totalAccessCount = 0;
            
            if (recentMemories && recentMemories.points) {
                recentMemories.points.forEach(point => {
                    const payload = point.payload;
                    
                    // Count by type
                    const type = payload.type || 'general';
                    typeCount[type] = (typeCount[type] || 0) + 1;
                    
                    // Count by importance
                    const importance = payload.importance || 'medium';
                    importanceCount[importance] = (importanceCount[importance] || 0) + 1;
                    
                    // Sum access counts
                    totalAccessCount += (payload.access_count || 0);
                });
            }
            
            // Format the statistics
            let stats = `Memory System Statistics:\n`;
            stats += `Total Memories: ${collectionInfo.points_count || 0}\n\n`;
            
            stats += `Memory Types:\n`;
            Object.entries(typeCount).forEach(([type, count]) => {
                stats += `- ${type}: ${count} (${Math.round(count/100*100)}%)\n`;
            });
            
            stats += `\nMemory Importance:\n`;
            Object.entries(importanceCount).forEach(([importance, count]) => {
                stats += `- ${importance}: ${count} (${Math.round(count/100*100)}%)\n`;
            });
            
            stats += `\nTotal Memory Accesses: ${totalAccessCount}\n`;
            stats += `Average Accesses Per Memory: ${(totalAccessCount / (recentMemories.points.length || 1)).toFixed(2)}\n`;
            
            return stats;
        } catch (error) {
            console.error('Error getting memory statistics:', error);
            return "Error retrieving memory statistics.";
        }
    }
    
    /**
     * Method to forget a specific memory
     * @param {string} memoryId - ID of memory to forget
     * @returns {boolean} - Success or failure
     */
    async forgetMemory(memoryId) {
        if (!this.vectorClient) {
            return false;
        }
        
        try {
            await this.vectorClient.delete(this.collectionName, {
                points: [memoryId]
            });
            
            console.log(`Memory ${memoryId} has been forgotten.`);
            return true;
        } catch (error) {
            console.error('Error forgetting memory:', error);
            return false;
        }
    }
    
    /**
     * Method to update memory importance
     * @param {string} memoryId - ID of memory to update
     * @param {string} importance - New importance level
     * @returns {boolean} - Success or failure
     */
    async updateMemoryImportance(memoryId, importance) {
        if (!this.vectorClient || !['low', 'medium', 'high', 'critical'].includes(importance)) {
            return false;
        }
        
        try {
            // Retrieve the memory
            const points = await this.vectorClient.retrieve(this.collectionName, {
                ids: [memoryId],
                with_payload: true,
                with_vectors: false
            });
            
            if (!points || points.length === 0) {
                console.warn(`Memory with ID ${memoryId} not found.`);
                return false;
            }
            
            const point = points[0];
            const payload = point.payload;
            
            // Update importance
            payload.importance = importance;
            
            // Update the memory with new importance
            await this.vectorClient.updatePayload(this.collectionName, {
                points: [{ id: memoryId, payload: payload }]
            });
            
            console.log(`Updated importance of memory ${memoryId} to ${importance}`);
            return true;
        } catch (error) {
            console.error('Error updating memory importance:', error);
            return false;
        }
    }
}
