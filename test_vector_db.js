import { QdrantClient } from '@qdrant/js-client-rest';
import { getKey, hasKey } from './src/utils/keys.js';
import { GPT } from './src/models/gpt.js';

// Test script to verify vector database connection and embedding generation
async function testVectorDb() {
    try {
        console.log('===============================');
        console.log('VECTOR DATABASE TEST SCRIPT');
        console.log('===============================');
        
        // Step 1: Check Qdrant connection
        console.log('\n[1] Testing Qdrant connection...');
        const client = new QdrantClient({ 
            url: 'http://localhost:6333' 
        });
        
        try {
            // Simple operation to test the connection
            console.log('Testing connection to Qdrant...');
            // Try to list collections (this method may vary by version)
            try {
                const response = await client.listCollections();
                console.log('✅ Qdrant connection successful using listCollections!');
                console.log('Response:', JSON.stringify(response, null, 2));
            } catch (listErr) {
                console.log('listCollections failed, trying getCollections instead...');
                try {
                    const response = await client.getCollections();
                    console.log('✅ Qdrant connection successful using getCollections!');
                    console.log('Response:', JSON.stringify(response, null, 2));
                } catch (getErr) {
                    console.log('getCollections also failed, trying basic API call...');
                    // Try a raw API call as fallback
                    const response = await fetch('http://localhost:6333/collections');
                    if (response.ok) {
                        const data = await response.json();
                        console.log('✅ Qdrant connection successful using fetch API!');
                        console.log('Response:', JSON.stringify(data, null, 2));
                    } else {
                        throw new Error(`HTTP error! Status: ${response.status}`);
                    }
                }
            }
        } catch (err) {
            console.error('❌ Failed to connect to Qdrant:', err.message);
            console.log('Please ensure Qdrant is running (check docker ps)');
            return;
        }
        
        // Step 2: Check OpenAI API key
        console.log('\n[2] Checking OpenAI API key...');
        if (!hasKey('OPENAI_API_KEY')) {
            console.error('❌ OPENAI_API_KEY not found!');
            console.log('Please set it in keys.json or as an environment variable');
            return;
        }
        console.log('✅ OPENAI_API_KEY is configured');
        
        // Step 3: Test embedding generation
        console.log('\n[3] Testing embedding generation...');
        const embeddingModel = new GPT('text-embedding-3-small');
        
        try {
            console.log('Generating test embedding...');
            const embedding = await embeddingModel.getEmbedding('Hello world');
            
            if (!embedding || !Array.isArray(embedding) || embedding.length === 0) {
                console.error('❌ Embedding generation failed - returned invalid data');
                return;
            }
            
            console.log(`✅ Successfully generated embedding (${embedding.length} dimensions)`);
        } catch (err) {
            console.error('❌ Embedding generation failed:', err.message);
            console.error('Error details:', err);
            return;
        }
        
        // Step 4: Create test collection
        console.log('\n[4] Creating test collection...');
        const testCollectionName = 'test_collection_' + Date.now();
        
        try {
            // Get embedding dimension for collection schema
            const testEmbedding = await embeddingModel.getEmbedding('Test');
            const embeddingSize = testEmbedding.length;
            
            console.log(`Creating collection with ${embeddingSize} dimensions...`);
            await client.createCollection(testCollectionName, {
                vectors: {
                    size: embeddingSize,
                    distance: 'Cosine'
                }
            });
            
            console.log(`✅ Successfully created test collection: ${testCollectionName}`);
            
            // Cleanup - delete test collection
            await client.deleteCollection(testCollectionName);
            console.log(`✅ Successfully deleted test collection`);
        } catch (err) {
            console.error(`❌ Collection creation test failed:`, err.message);
            console.error('Error details:', err);
            return;
        }
        
        console.log('\n===============================');
        console.log('✅ ALL TESTS PASSED!');
        console.log('Vector database and embedding system are working properly.');
        console.log('===============================');
    } catch (err) {
        console.error('Test failed with unexpected error:', err);
        console.error(err);
    }
}

testVectorDb();
