/**
 * Memory Storage and Retrieval Test Script
 * 
 * This script tests whether memories are being properly:
 * 1. Stored in the Qdrant vector database
 * 2. Retrieved with appropriate relevance scores
 * 3. Respecting the high relevance threshold (0.45)
 */

import { MemoryManager } from './src/models/memory.js';
import { GPT } from './src/models/gpt.js';
import { QdrantClient } from '@qdrant/js-client-rest';

async function verifyMemorySystem() {
  console.log('================================');
  console.log('MEMORY SYSTEM VERIFICATION TEST');
  console.log('================================');
  
  // Create embedding model
  console.log('\n[1] Setting up embedding model...');
  const model = new GPT('text-embedding-3-small');
  console.log('✓ Embedding model initialized');
  
  // Create memory manager
  console.log('\n[2] Creating memory manager...');
  const memoryManager = new MemoryManager(
    model,                      // embedding model
    'http://localhost:6333',    // Qdrant URL
    { collectionName: 'memory_verification_test' }
  );
  console.log('✓ Memory manager created');
  
  // Connect to Qdrant directly for verification
  console.log('\n[3] Connecting to Qdrant for verification...');
  const qdrantClient = new QdrantClient({ url: 'http://localhost:6333' });
  console.log('✓ Connected to Qdrant for verification');
  
  // First, clear any existing test collection
  try {
    await qdrantClient.deleteCollection('memory_verification_test');
    console.log('✓ Cleared existing test collection');
  } catch (err) {
    console.log('No existing test collection to clear');
  }
  
  // Test storing memories
  console.log('\n[4] Testing memory storage...');
  
  // Sample memories with different topics
  const memories = [
    {
      text: 'Building a spiral structure requires careful planning. Start with a solid foundation and work your way up, placing blocks in a circular pattern with a slight offset each layer.',
      metadata: { type: 'construction', tags: ['building', 'spiral', 'structure'] }
    },
    {
      text: 'Tornadoes are dangerous weather phenomena characterized by a violently rotating column of air that is in contact with both the surface of the Earth and a cumulonimbus cloud.',
      metadata: { type: 'knowledge', tags: ['weather', 'tornado'] }
    },
    {
      text: 'To build a house in Minecraft, you need wood planks, glass, doors, and a roof. Make sure to light the inside with torches to prevent monsters from spawning.',
      metadata: { type: 'gaming', tags: ['minecraft', 'house', 'building'] }
    }
  ];
  
  // Store each memory
  for (const memory of memories) {
    console.log(`Storing memory: "${memory.text.substring(0, 50)}..."`);
    const success = await memoryManager.storeMemory(memory.text, memory.metadata);
    if (success) {
      console.log('✓ Memory stored successfully');
    } else {
      console.error('× Failed to store memory');
    }
  }
  
  // Verify storage by counting points
  console.log('\n[5] Verifying storage by counting points...');
  try {
    const collectionInfo = await qdrantClient.getCollection('memory_verification_test');
    console.log(`Collection info: ${JSON.stringify(collectionInfo, null, 2)}`);
    
    // Check if points exist
    const count = collectionInfo.vectors_count;
    console.log(`Points count: ${count}`);
    if (count === memories.length) {
      console.log('✓ All memories stored correctly');
    } else {
      console.error(`× Expected ${memories.length} memories, but found ${count}`);
    }
  } catch (err) {
    console.error('Error verifying storage:', err.message);
  }
  
  // Test retrieving memories with different relevance levels
  console.log('\n[6] Testing memory retrieval with different queries...');
  
  const queries = [
    {
      text: 'How do I build a spiral structure?',
      expected: 'spiral structure', // Should have high relevance to the first memory
      expectedMatch: true
    },
    {
      text: 'What is a tornado?',
      expected: 'dangerous weather', // Should have high relevance to the second memory
      expectedMatch: true
    },
    {
      text: 'How to cook pasta?',
      expected: null, // Should have low relevance to all memories
      expectedMatch: false
    }
  ];
  
  // Test with different relevance thresholds
  const thresholds = [
    { name: 'Standard threshold (0.7)', value: 0.7 },
    { name: 'High threshold (0.45)', value: 0.45 }
  ];
  
  for (const threshold of thresholds) {
    console.log(`\n[6.${thresholds.indexOf(threshold) + 1}] Testing with ${threshold.name}...`);
    
    for (const query of queries) {
      console.log(`\nQuery: "${query.text}"`);
      
      // Retrieve memories with this threshold
      const options = { relevanceThreshold: threshold.value };
      const result = await memoryManager.retrieveRelevantMemories(query.text, 5, options);
      
      console.log(`Retrieval result: ${result.substring(0, 150)}...`);
      
      // Check if expected content is in the result (when we expect a match)
      if (query.expectedMatch) {
        if (result.includes(query.expected)) {
          console.log(`✓ Found expected content "${query.expected}" with threshold ${threshold.value}`);
        } else {
          console.log(`× Did not find expected content "${query.expected}" with threshold ${threshold.value}`);
        }
      } 
      // Check that there's no match when we don't expect one
      else {
        if (result.includes('No memories found') || result.includes('No relevant memories')) {
          console.log(`✓ Correctly found no memories for irrelevant query with threshold ${threshold.value}`);
        } else {
          console.log(`× Unexpectedly found memories for irrelevant query with threshold ${threshold.value}`);
        }
      }
    }
  }
  
  // Clean up the test collection
  // console.log('\n[7] Cleaning up test collection...');
  // try {
  //   await qdrantClient.deleteCollection('memory_verification_test');
  //   console.log('✓ Test collection deleted');
  // } catch (err) {
  //   console.error('Error deleting test collection:', err.message);
  // }
  
  console.log('\n================================');
  console.log('MEMORY SYSTEM VERIFICATION COMPLETE');
  console.log('================================');
}

// Run the test
verifyMemorySystem().catch(err => {
  console.error('Test failed with error:', err);
});
