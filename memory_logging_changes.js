// ======= MEMORY LOGGING ENHANCEMENTS =======
// Copy and paste these code sections into their corresponding locations in prompter.js

// === ENHANCEMENT 1: Beginning of retrieveRelevantMemories method ===
// Replace the beginning of the method with this:
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


// === ENHANCEMENT 2: Search results section ===
// Replace the searchResults section with this:
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


// === ENHANCEMENT 3: $LONG_TERM_MEMORY section in replaceStrings method ===
// Replace the $LONG_TERM_MEMORY section with this:
if (prompt.includes('$LONG_TERM_MEMORY') && messages && messages.length > 0) {
    const lastMessage = messages[messages.length - 1];
    console.log(`\n=== RETRIEVING MEMORIES BASED ON LAST MESSAGE: "${lastMessage.content}" ===`);
    const relevantMemories = await this.retrieveRelevantMemories(lastMessage.content, 3);
    console.log(`\n=== REPLACING $LONG_TERM_MEMORY IN PROMPT ===`);
    prompt = prompt.replaceAll('$LONG_TERM_MEMORY', relevantMemories);
}
