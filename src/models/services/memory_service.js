/**
 * MemoryService - Enhanced memory management with caching, timeouts and error handling
 * Implements the user's customization to only use memories with relevance scores above 0.85
 */
export class MemoryService {
  constructor(embeddingModel, dbConfig = {}) {
    this.embeddingModel = embeddingModel;
    this.dbUrl = dbConfig.url || 'http://localhost:6333';
    this.collectionName = dbConfig.collectionName || 'agent_memories';
    this.vectorSize = dbConfig.vectorSize || null;
    this.memoryManager = null;
    
    // Memory cache to reduce repeated queries
    this.memoryCache = {};
    this.cacheTTL = 60000; // 1 minute cache lifetime
    
    // Default high relevance threshold (as per user preference)
    this.minRelevanceScore = 0.85;
    
    // Request timeout values
    this.defaultTimeout = 5000;
  }
  
  /**
   * Initialize the memory system
   * @param {Object} MemoryManager - Constructor for the memory manager
   */
  async initialize(MemoryManager) {
    try {
      this.memoryManager = new MemoryManager(
        this.embeddingModel,
        this.dbUrl,
        {
          collectionName: this.collectionName,
          vectorSize: this.vectorSize
        }
      );
      
      await this.memoryManager.initVectorMemory();
      console.log(`Memory system initialized with collection: ${this.collectionName}`);
      return true;
    } catch (error) {
      console.error('Failed to initialize memory system:', error);
      return false;
    }
  }
  
  /**
   * Store a memory with metadata
   * @param {string} text - Memory text to store
   * @param {Object} metadata - Additional metadata
   * @returns {Promise<Object>} Stored memory result
   */
  async storeMemory(text, metadata = {}) {
    if (!text || text.trim() === '') {
      console.warn('Cannot store empty memory text');
      return null;
    }
    
    if (!this.memoryManager) {
      console.warn('Memory system not available, unable to store memory');
      return null;
    }
    
    try {
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Memory storage timeout')), this.defaultTimeout);
      });
      
      const storePromise = this.memoryManager.storeMemory(text, metadata);
      const result = await Promise.race([storePromise, timeoutPromise]);
      
      // Clear relevant cache entries
      this.invalidateRelatedCacheEntries(text);
      
      console.log('Memory stored successfully:', result);
      return result;
    } catch (error) {
      console.error('Error storing memory:', error);
      return null;
    }
  }
  
  /**
   * Retrieve memories relevant to a query with high relevance threshold
   * @param {string} query - Search query
   * @param {number} limit - Maximum number of memories to retrieve
   * @param {Object} options - Additional options
   * @returns {Promise<string>} Formatted relevant memories
   */
  async retrieveRelevantMemories(query, limit = 10, options = {}) {
    if (!this.memoryManager) {
      return "Memory system not available.";
    }
    
    // If query is empty or too short, return early
    if (!query || query.trim().length < 3) {
      return "No relevant memories found.";
    }
    
    try {
      // Check cache first
      const cacheKey = `${query}_${limit}_${JSON.stringify(options)}`;
      if (this.memoryCache[cacheKey] && 
          (Date.now() - this.memoryCache[cacheKey].timestamp < this.cacheTTL)) {
        console.log('Using cached memory results for query:', query.substring(0, 30) + '...');
        return this.memoryCache[cacheKey].result;
      }
      
      // Set high relevance threshold based on user's preference
      options.minRelevanceScore = options.minRelevanceScore || this.minRelevanceScore;
      
      // Add timeout to prevent hanging
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Memory retrieval timeout')), 
          options.timeout || this.defaultTimeout);
      });
      
      const retrievalPromise = this.memoryManager.retrieveRelevantMemories(query, limit, options);
      const result = await Promise.race([retrievalPromise, timeoutPromise]);
      
      // Only cache if we got a meaningful result
      if (result && result !== "No relevant memories found.") {
        this.memoryCache[cacheKey] = {
          result,
          timestamp: Date.now()
        };
      }
      
      return result;
    } catch (error) {
      console.error('Error retrieving memories:', error);
      // Return graceful fallback instead of failing
      return "Unable to access memories at this time.";
    }
  }
  
  /**
   * Invalidate cache entries that might be related to a text
   * @param {string} text - Text to check relevance against
   */
  invalidateRelatedCacheEntries(text) {
    // Simple approach: invalidate cache entries where the query contains
    // significant words from the new memory text
    const significantWords = text
      .toLowerCase()
      .split(/\s+/)
      .filter(word => word.length > 4) // Only consider substantial words
      .slice(0, 5);    // Limit to first few significant words
    
    Object.keys(this.memoryCache).forEach(cacheKey => {
      const query = cacheKey.split('_')[0];
      const isRelated = significantWords.some(word => 
        query.toLowerCase().includes(word));
      
      if (isRelated) {
        console.log('Invalidating related cache entry:', cacheKey);
        delete this.memoryCache[cacheKey];
      }
    });
  }
  
  /**
   * Add tags to a memory
   * @param {string} memoryId - ID of the memory
   * @param {Array} tags - Tags to add
   * @returns {Promise<boolean>} Success status
   */
  async addTagsToMemory(memoryId, tags = []) {
    if (!this.memoryManager) return false;
    
    try {
      return await this.memoryManager.addTagsToMemory(memoryId, tags);
    } catch (error) {
      console.error('Error adding tags to memory:', error);
      return false;
    }
  }
  
  /**
   * Search memories by tags
   * @param {Array} tags - Tags to search for
   * @param {number} limit - Maximum number of memories to retrieve
   * @returns {Promise<string>} Formatted memories
   */
  async searchMemoriesByTags(tags = [], limit = 10) {
    if (!this.memoryManager) {
      return "Memory system not available.";
    }
    
    try {
      const cacheKey = `tags_${tags.join('_')}_${limit}`;
      if (this.memoryCache[cacheKey] && 
          (Date.now() - this.memoryCache[cacheKey].timestamp < this.cacheTTL)) {
        return this.memoryCache[cacheKey].result;
      }
      
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Memory tag search timeout')), this.defaultTimeout);
      });
      
      const searchPromise = this.memoryManager.searchMemoriesByTags(tags, limit);
      const result = await Promise.race([searchPromise, timeoutPromise]);
      
      if (result && result !== "No memories found with these tags.") {
        this.memoryCache[cacheKey] = {
          result,
          timestamp: Date.now()
        };
      }
      
      return result;
    } catch (error) {
      console.error('Error searching memories by tags:', error);
      return "Unable to search memories by tags at this time.";
    }
  }
  
  /**
   * Get memory statistics
   * @returns {Promise<string>} Formatted statistics
   */
  async getMemoryStats() {
    if (!this.memoryManager) {
      return "Memory system not available.";
    }
    
    try {
      return await this.memoryManager.getMemoryStats();
    } catch (error) {
      console.error('Error getting memory stats:', error);
      return "Unable to retrieve memory statistics at this time.";
    }
  }
  
  /**
   * Delete a memory
   * @param {string} memoryId - ID of the memory to delete
   * @returns {Promise<boolean>} Success status
   */
  async forgetMemory(memoryId) {
    if (!this.memoryManager) return false;
    
    try {
      const result = await this.memoryManager.forgetMemory(memoryId);
      
      // Clear entire cache on memory deletion as we don't know what's affected
      this.memoryCache = {};
      
      return result;
    } catch (error) {
      console.error('Error forgetting memory:', error);
      return false;
    }
  }
  
  /**
   * Update a memory's importance
   * @param {string} memoryId - ID of the memory
   * @param {string} importance - New importance value
   * @returns {Promise<boolean>} Success status
   */
  async updateMemoryImportance(memoryId, importance) {
    if (!this.memoryManager) return false;
    
    try {
      return await this.memoryManager.updateMemoryImportance(memoryId, importance);
    } catch (error) {
      console.error('Error updating memory importance:', error);
      return false;
    }
  }
  
  /**
   * Clear the memory cache
   */
  clearCache() {
    this.memoryCache = {};
    console.log('Memory cache cleared');
  }
}
