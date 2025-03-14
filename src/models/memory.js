import { v4 as uuidv4 } from 'uuid';
import { QdrantClient } from '@qdrant/js-client-rest';

/**
 * Memory Management System
 * Handles storage, retrieval, and management of agent memories
 */
export class MemoryManager {
    /**
     * Create a memory manager
     * @param {Object} agent - The agent this memory manager belongs to
     * @param {Object} embedding_model - The embedding model to use for vector encoding
     */
    constructor(agent, embedding_model) {
        this.agent = agent;
        this.embedding_model = embedding_model;
        this.collectionName = `${agent.name}_memories`;
        this.vectorClient = null;
        this._isVectorMemoryOperation = false;
        
        // Initialize the vector database
        this.initVectorMemory();
    }

    /**
     * Initialize the vector memory database
     */
    async initVectorMemory() {
        try {
            if (!this.embedding_model) {
                console.warn('No embedding model available for vector memory');
                return;
            }
            
            // Initialize Qdrant client
            this.vectorClient = new QdrantClient({ 
                url: 'http://localhost:6333' 
            });
            
            // Get embedding dimension from model
            const sampleEmbedding = await this.getEmbedding("Hello world");
            if (!sampleEmbedding) {
                console.error('Failed to generate sample embedding for memory initialization');
                return;
            }
            
            const embeddingSize = sampleEmbedding.length;
            console.log(`Using ${embeddingSize}-dimensional embeddings for memory storage`);
            
            // Check if collection exists and create if it doesn't
            try {
                await this.vectorClient.getCollection(this.collectionName);
                console.log(`Memory collection ${this.collectionName} already exists`);
            } catch (err) {
                console.log(`Creating memory collection ${this.collectionName}...`);
                
                await this.vectorClient.createCollection(this.collectionName, {
                    vectors: {
                        size: embeddingSize,
                        distance: 'Cosine'
                    },
                    optimizers_config: {
                        default_segment_number: 2
                    }
                });
                
                console.log(`Memory collection ${this.collectionName} created`);
            }
        } catch (err) {
            console.error('Failed to initialize vector memory:', err);
            this.vectorClient = null;
        }
    }

    /**
     * Generate an embedding vector for text
     * @param {string} text - Text to generate an embedding for
     * @returns {Array<number>|null} - Embedding vector or null if failed
     */
    async getEmbedding(text) {
        if (!this.embedding_model) {
            return null;
        }
        
        try {
            // Set flag to indicate this is a vector memory operation
            this._isVectorMemoryOperation = true;
            
            // Get embedding
            const embedding = await this.embedding_model.getEmbedding(text);
            
            // Reset flag
            this._isVectorMemoryOperation = false;
            
            return embedding;
        } catch (error) {
            console.error('Error generating embedding:', error);
            
            // Reset flag
            this._isVectorMemoryOperation = false;
            
            return null;
        }
    }

    /**
     * Store memory with structured metadata
     * @param {string} text - Memory text content
     * @param {Object} metadata - Additional metadata for the memory 
     * @returns {boolean} - Success or failure
     */
    async storeMemory(text, metadata = {}) {
        if (!this.vectorClient || !this.embedding_model) {
            console.warn('Cannot store memory: Vector client or embedding model not available');
            return false;
        }

        console.log(`Storing memory: "${text.substring(0, 100)}..."`);
        
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
            
            console.log('Generated memory embedding (' + embedding.length + ' dimensions)');
            
            // Store memory with enhanced structured metadata
            await this.vectorClient.upsert(this.collectionName, {
                points: [{
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
                }]
            });
            
            console.log(`Memory stored successfully with ID ${id}`);
            return true;
        } catch (error) {
            console.error('Error storing memory:', error);
            return false;
        }
    }

    /**
     * Retrieve memories relevant to a query
     * @param {string} query - Query to search for
     * @param {number} limit - Maximum number of results to return
     * @param {Object} options - Filter options
     * @returns {string} - Formatted memory results
     */
    async retrieveRelevantMemories(query, limit = 10, options = {}) {
        if (!this.vectorClient || !this.embedding_model) {
            console.warn('Cannot retrieve memories: Vector client or embedding model not available');
            return "No memory system available.";
        }

        console.log(`Retrieving memories relevant to: "${query.substring(0, 100)}..."`);
        
        try {
            // Generate query embedding
            console.log('Generating query embedding...');
            const queryEmbedding = await this.getEmbedding(query);
            
            if (!queryEmbedding) {
                console.warn('Failed to generate embedding for memory query');
                return "Unable to search long-term memories due to embedding generation failure.";
            }
            
            console.log('Generated query embedding (' + queryEmbedding.length + ' dimensions)');
            
            // Build search filters based on options
            let filter = null;
            if (options.type || options.importance || options.timeframe) {
                filter = { must: [] };
                
                if (options.type) {
                    filter.must.push({
                        key: 'type',
                        match: { value: options.type }
                    });
                }
                
                if (options.importance) {
                    filter.must.push({
                        key: 'importance',
                        match: { value: options.importance }
                    });
                }
                
                if (options.timeframe) {
                    // Convert timeframe to date range
                    const now = new Date();
                    let startDate = new Date();
                    
                    if (options.timeframe === 'recent') {
                        startDate.setDate(now.getDate() - 7); // Last week
                    } else if (options.timeframe === 'medium') {
                        startDate.setMonth(now.getMonth() - 3); // Last 3 months
                    } else if (options.timeframe === 'old') {
                        startDate.setFullYear(now.getFullYear() - 1); // Last year
                    }
                    
                    filter.must.push({
                        key: 'timestamp',
                        range: {
                            gte: startDate.toISOString()
                        }
                    });
                }
            }
            
            // Search for relevant memories with optional filtering
            console.log(`Searching collection "${this.collectionName}" for ${limit} relevant memories...`);
            
            const searchResults = await this.vectorClient.search({
                collection_name: this.collectionName,
                query_vector: queryEmbedding,
                limit: limit,
                filter: filter,
                with_payload: true,
                with_vectors: false
            });
            
            console.log(`Found ${searchResults?.length || 0} memories`);
            
            if (!searchResults || searchResults.length === 0) {
                return "No relevant long-term memories found.";
            }
            
            // Define a high relevance threshold
            const HIGH_RELEVANCE_THRESHOLD = 0.85; // Keeping the customized high threshold
            
            // Filter for only highly relevant results
            const highlyRelevantResults = searchResults.filter(result => result.score >= HIGH_RELEVANCE_THRESHOLD);
            
            console.log(`Found ${highlyRelevantResults.length} highly relevant memories (score >= ${HIGH_RELEVANCE_THRESHOLD})`);
            
            // Update access metadata for retrieved memories
            this._updateMemoryAccessMetadata(highlyRelevantResults.length > 0 ? 
                highlyRelevantResults.map(r => r.id) : 
                [searchResults[0].id]);
            
            // If no highly relevant memories found but we have some results, 
            // return the top result to prevent empty memory responses
            if (highlyRelevantResults.length === 0) {
                // Instead of returning nothing, use the highest scoring memory if it's above a lower threshold
                if (searchResults[0] && searchResults[0].score > 0.7) {
                    console.log(`No highly relevant memories found, but using top result with score ${searchResults[0].score.toFixed(2)}`);
                    const topResult = searchResults[0];
                    return this._formatStructuredMemory(topResult, true);
                }
                return "No highly relevant long-term memories found.";
            }
            
            // Format the results in a structured way
            return this._formatStructuredMemories(highlyRelevantResults);
        } catch (error) {
            console.error('Error retrieving memories:', error);
            return "Error retrieving long-term memories.";
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
     * Update memory access metadata
     * @param {Array<string>} memoryIds - IDs of memories to update
     */
    async _updateMemoryAccessMetadata(memoryIds) {
        if (!Array.isArray(memoryIds) || memoryIds.length === 0 || !this.vectorClient) {
            return;
        }
        
        try {
            // Update last_accessed and access_count for each memory
            for (const id of memoryIds) {
                const points = await this.vectorClient.retrieve(this.collectionName, {
                    ids: [id],
                    with_payload: true,
                    with_vectors: false
                });
                
                if (points && points.length > 0) {
                    const point = points[0];
                    const payload = point.payload;
                    
                    // Update access metadata
                    payload.last_accessed = new Date().toISOString();
                    payload.access_count = (payload.access_count || 0) + 1;
                    
                    // Update the point with new metadata
                    await this.vectorClient.updatePayload(this.collectionName, {
                        points: [{ id: id, payload: payload }]
                    });
                }
            }
        } catch (error) {
            console.warn('Failed to update memory access metadata:', error);
        }
    }

    /**
     * Helper method to add tags to an existing memory
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
