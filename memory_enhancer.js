// This file contains the complete retrieveRelevantMemories method with enhanced logging
// Copy and paste this entire method into your prompter.js file, replacing the current method

async retrieveRelevantMemories(query, limit = 10) {
    if (!this.vectorClient || !this.embedding_model) {
        console.warn('Cannot retrieve memories: Vector client or embedding model not available');
        return "No long-term memories available.";
    }
    
    try {
        console.log(`\n=== VECTOR MEMORY SEARCH START ===`);
        console.log(`Retrieving memories relevant to: "${query}"`);
        
        // Generate embedding for the query
        console.log('Generating query embedding...');
        const queryEmbedding = await this.getEmbedding(query);
        if (!queryEmbedding || queryEmbedding.length === 0) {
            console.warn('Failed to generate embedding for query');
            return "No long-term memories available.";
        }
        console.log(`Generated query embedding (${queryEmbedding.length} dimensions)`);
        
        // Search for similar memories
        console.log(`Searching collection "${this.collectionName}" for ${limit} relevant memories...`);
        const searchResults = await this.vectorClient.search(this.collectionName, {
            vector: queryEmbedding,
            limit: limit,
            with_payload: true,
            with_vectors: false
        });
        
        console.log(`\n=== FOUND ${searchResults?.length || 0} MEMORIES ===`);
        
        if (!searchResults || searchResults.length === 0) {
            console.log("NO MEMORIES FOUND IN VECTOR DB");
            return "No relevant long-term memories found.";
        }
        
        // Format the results
        let formattedResults = "Relevant long-term memories:\n\n";
        
        console.log("\n--- RETRIEVED MEMORIES ---");
        searchResults.forEach((result, index) => {
            const memory = result.payload.text;
            const timestamp = new Date(result.payload.timestamp).toLocaleString();
            const score = result.score.toFixed(4);
            
            console.log(`\nMEMORY ${index + 1}:`);
            console.log(`Score: ${score}`);
            console.log(`Time: ${timestamp}`);
            console.log(`Full Text: "${memory}"`);
            
            formattedResults += `Memory ${index + 1} (relevance: ${score}):\n${memory}\n`;
            formattedResults += `Timestamp: ${timestamp}\n\n`;
        });
        
        console.log("\n=== VECTOR MEMORY SEARCH COMPLETE ===");
        return formattedResults;
    } catch (error) {
        console.error('Error retrieving memories:', error);
        return "Error retrieving long-term memories.";
    }
}
