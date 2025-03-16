/**
 * ModelService - Manages connections to language models
 * Implements connection pooling, health checks, and error handling
 */
export class ModelService {
  constructor(profile) {
    this.models = new Map();
    this.connectionPools = new Map();
    this.healthStatus = new Map();
    this.profile = profile;
    this.lastRequestTime = 0;
    this.cooldown = profile.cooldown || 0;
    
    // Initialize fallback models if configured
    this.fallbackModels = {};
  }
  
  /**
   * Register a model for use
   * @param {string} modelId - Unique identifier for the model
   * @param {Object} modelInstance - Instance of the model class
   * @param {number} poolSize - Size of the connection pool
   */
  registerModel(modelId, modelInstance, poolSize = 3) {
    this.models.set(modelId, modelInstance);
    this.connectionPools.set(modelId, Array(poolSize).fill(null).map(() => ({ 
      connection: null,
      lastUsed: 0,
      inUse: false
    })));
    this.healthStatus.set(modelId, { healthy: true, lastCheck: 0 });
    
    // Schedule health checks
    this.scheduleHealthCheck(modelId);
  }
  
  /**
   * Register a fallback model for a primary model
   * @param {string} primaryId - ID of the primary model
   * @param {string} fallbackId - ID of the fallback model
   */
  registerFallback(primaryId, fallbackId) {
    this.fallbackModels[primaryId] = fallbackId;
  }
  
  /**
   * Get a connection from the pool
   * @param {string} modelId - ID of the model
   * @returns {Object} Connection object
   */
  async getConnection(modelId) {
    const pool = this.connectionPools.get(modelId);
    if (!pool) throw new Error(`Model ${modelId} not registered`);
    
    // Find available connection or least recently used
    let connection = pool.find(conn => !conn.inUse) || 
                    pool.sort((a, b) => a.lastUsed - b.lastUsed)[0];
    
    if (connection.inUse) {
      console.warn(`All connections for ${modelId} in use, reusing least recently used`);
    }
    
    connection.inUse = true;
    return connection;
  }
  
  /**
   * Release a connection back to the pool
   * @param {string} modelId - ID of the model
   * @param {Object} connection - Connection object
   */
  releaseConnection(modelId, connection) {
    connection.lastUsed = Date.now();
    connection.inUse = false;
  }
  
  /**
   * Schedule health checks for a model
   * @param {string} modelId - ID of the model
   */
  scheduleHealthCheck(modelId) {
    // Periodic health check
    setInterval(async () => {
      try {
        // Simple health check - can be customized based on model type
        const model = this.models.get(modelId);
        if (typeof model.ping === 'function') {
          await model.ping();
        } else if (typeof model.sendRequest === 'function') {
          // Use a tiny request as health check if no ping method
          await model.sendRequest([], "Health check");
        }
        
        this.healthStatus.set(modelId, { healthy: true, lastCheck: Date.now() });
      } catch (error) {
        console.error(`Health check failed for ${modelId}:`, error);
        this.healthStatus.set(modelId, { healthy: false, lastCheck: Date.now(), error });
      }
    }, 60000); // Check every minute
  }
  
  /**
   * Check if a model is healthy
   * @param {string} modelId - ID of the model
   * @returns {boolean} Whether the model is healthy
   */
  isHealthy(modelId) {
    return this.healthStatus.get(modelId)?.healthy || false;
  }
  
  /**
   * Apply cooldown between requests
   * @returns {Promise} Resolves when cooldown is complete
   */
  async checkCooldown() {
    const elapsed = Date.now() - this.lastRequestTime;
    if (elapsed < this.cooldown && this.cooldown > 0) {
      await new Promise(r => setTimeout(r, this.cooldown - elapsed));
    }
    this.lastRequestTime = Date.now();
  }
  
  /**
   * Send a request to a model with retry and fallback logic
   * @param {string} modelId - ID of the model to use
   * @param {Array} messages - Messages to send
   * @param {string} systemPrompt - System prompt
   * @param {Object} options - Additional options
   * @returns {Promise<string>} Model response
   */
  async sendRequestWithRetry(modelId, messages, systemPrompt, options = {}) {
    const { maxRetries = 3, backoffFactor = 1.5 } = options;
    let retries = 0;
    let lastError = null;
    
    await this.checkCooldown();
    
    while (retries < maxRetries) {
      try {
        const model = this.models.get(modelId);
        if (!model) throw new Error(`Model ${modelId} not registered`);
        
        if (!this.isHealthy(modelId)) {
          console.warn(`Model ${modelId} is unhealthy, trying fallback if available`);
          if (this.fallbackModels[modelId]) {
            return this.sendRequestWithRetry(
              this.fallbackModels[modelId], 
              messages, 
              systemPrompt, 
              options
            );
          }
        }
        
        // Set timeout to prevent hanging requests
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Request timeout')), options.timeout || 30000);
        });
        
        const requestPromise = model.sendRequest(messages, systemPrompt);
        const response = await Promise.race([requestPromise, timeoutPromise]);
        
        return response;
      } catch (error) {
        lastError = error;
        console.warn(`Model request failed (${retries + 1}/${maxRetries}): ${error.message}`);
        
        // Exponential backoff
        const delay = Math.pow(backoffFactor, retries) * 1000;
        await new Promise(r => setTimeout(r, delay));
        retries++;
      }
    }
    
    // If all retries failed, try fallback model if available
    if (this.fallbackModels[modelId]) {
      console.log(`All retries failed for ${modelId}, using fallback model ${this.fallbackModels[modelId]}`);
      return this.sendRequestWithRetry(
        this.fallbackModels[modelId], 
        messages, 
        systemPrompt, 
        options
      );
    }
    
    throw lastError || new Error(`Failed to get response from model ${modelId}`);
  }
  
  /**
   * Send a request to the chat model
   * @param {Array} messages - Messages to send
   * @param {string} systemPrompt - System prompt
   * @param {Object} options - Additional options
   * @returns {Promise<string>} Model response
   */
  async sendChatRequest(messages, systemPrompt, options = {}) {
    return this.sendRequestWithRetry('chat', messages, systemPrompt, options);
  }
  
  /**
   * Send a request to the code model
   * @param {Array} messages - Messages to send
   * @param {string} systemPrompt - System prompt
   * @param {Object} options - Additional options
   * @returns {Promise<string>} Model response
   */
  async sendCodeRequest(messages, systemPrompt, options = {}) {
    return this.sendRequestWithRetry('code', messages, systemPrompt, options);
  }
}
