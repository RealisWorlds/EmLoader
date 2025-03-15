import { MemoryManager } from './src/models/memory.js';
import { GPT } from './src/models/gpt.js';
import { hasKey } from './src/utils/keys.js';

// Test script that verifies all aspects of the memory system
async function testMemorySystem() {
    try {
        console.log('===============================');
        console.log('MEMORY SYSTEM TEST SCRIPT');
        console.log('===============================');
        
        // Step 1: Check OpenAI API key
        console.log('\n[1] Checking OpenAI API key...');
        if (!hasKey('OPENAI_API_KEY')) {
            console.error('❌ OPENAI_API_KEY not found!');
            console.log('Please set it in keys.json or as an environment variable');
            return;
        }
        console.log('✅ OPENAI_API_KEY is configured');
        
        // Step 2: Create embedding model
        console.log('\n[2] Creating embedding model...');
        const embeddingModel = new GPT('text-embedding-3-small');
        console.log('✅ Embedding model created');
        
        // Step 3: Initialize memory manager with explicit collection name
        console.log('\n[3] Initializing memory manager...');
        const collectionName = 'test_memory_' + Date.now();
        console.log(`Using collection name: ${collectionName}`);
        
        const memoryManager = new MemoryManager(
            embeddingModel,
            'http://localhost:6333',
            {
                collectionName: collectionName,
                vectorSize: 1536
            }
        );
        console.log('✅ Memory manager initialized');
        
        // Step 4: Initialize vector database
        console.log('\n[4] Initializing vector memory...');
        await memoryManager.initVectorMemory();
        console.log('✅ Vector memory initialized');
        
        // Step 5: Store a test memory
        console.log('\n[5] Storing test memory...');
        const testMemory = 'This is a test memory about chocolate cake. Chocolate cake is delicious.';
        const storeResult = await memoryManager.storeMemory(testMemory, {
            type: 'test',
            importance: 'high',
            source: 'test_script',
            tags: ['test', 'chocolate', 'cake']
        });
        
        if (storeResult) {
            console.log('✅ Test memory stored successfully');
        } else {
            console.error('❌ Failed to store test memory');
            return;
        }
        
        // Step 6: Store another test memory
        console.log('\n[6] Storing second test memory...');
        const testMemory2 = 'The sky is blue and the sun is yellow. Clouds are white and fluffy.';
        const storeResult2 = await memoryManager.storeMemory(testMemory2, {
            type: 'test',
            importance: 'medium',
            source: 'test_script',
            tags: ['test', 'sky', 'nature']
        });
        
        if (storeResult2) {
            console.log('✅ Second test memory stored successfully');
        } else {
            console.error('❌ Failed to store second test memory');
            return;
        }
        
        // Step 7: Retrieve relevant memory with exact query
        console.log('\n[7] Retrieving memory with exact query...');
        const exactQuery = 'Tell me about chocolate cake';
        const exactResults = await memoryManager.retrieveRelevantMemories(exactQuery, 5);
        console.log('Results for exact query:');
        console.log(exactResults);
        
        if (exactResults && !exactResults.includes('No relevant long-term memories found')) {
            console.log('✅ Successfully retrieved memory for exact query');
        } else {
            console.warn('⚠️ Didn\'t get expected results for exact query');
        }
        
        // Step 8: Retrieve with related query
        console.log('\n[8] Retrieving memory with related query...');
        const relatedQuery = 'What desserts do we know about?';
        const relatedResults = await memoryManager.retrieveRelevantMemories(relatedQuery, 5);
        console.log('Results for related query:');
        console.log(relatedResults);
        
        // Step 9: Clean up test collection
        console.log('\n[9] Cleaning up test collection...');
        try {
            const qdrantClient = memoryManager.vectorClient;
            await qdrantClient.deleteCollection(collectionName);
            console.log(`✅ Successfully deleted test collection '${collectionName}'`);
        } catch (err) {
            console.error('❌ Error deleting test collection:', err.message);
        }
        
        console.log('\n===============================');
        console.log('MEMORY SYSTEM TEST COMPLETE');
        console.log('===============================');
    } catch (err) {
        console.error('Test failed with unexpected error:', err);
    }
}

// Run the test
testMemorySystem();
