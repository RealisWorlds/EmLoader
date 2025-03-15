/**
 * High-Threshold Memory Test Script
 * 
 * This script specifically tests the 0.45 relevance threshold to ensure 
 * the memory system only returns memories with very high relevance scores.
 */

import { MemoryManager } from './src/models/memory.js';
import { GPT } from './src/models/gpt.js';
import { QdrantClient } from '@qdrant/js-client-rest';

async function testHighThresholdMemory() {
  console.log('================================');
  console.log('HIGH THRESHOLD MEMORY TEST');
  console.log('================================');
  
  // Create embedding model and memory manager
  console.log('\n[1] Setting up embedding model and memory manager...');
  const model = new GPT('text-embedding-3-small');
  const memoryManager = new MemoryManager(
    model,
    'http://localhost:6333',
    { collectionName: 'threshold_test' }
  );
  console.log('✓ Memory system initialized');
  
  // Connect directly to Qdrant for verification
  const qdrant = new QdrantClient({ url: 'http://localhost:6333' });
  
  // Clean up any previous test collection
  try {
    await qdrant.deleteCollection('threshold_test');
    console.log('✓ Cleared previous test collection');
  } catch (err) {
    // Ignore errors if collection doesn't exist
  }
  
  // Wait a moment for initialization
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Create test collection manually to ensure it exists
  try {
    await qdrant.createCollection('threshold_test', {
      vectors: {
        size: 1536,
        distance: "Cosine"
      }
    });
    console.log('✓ Created test collection');
  } catch (err) {
    console.log('Collection already exists or creation failed:', err.message);
  }
  
  // Test memories with varying degrees of relevance to our test queries
  const testMemories = [
    // Very specific memory about building a tornado (should have very high relevance to tornado queries)
    {
      text: "To build a tornado in Minecraft, start with a spiral structure using glass blocks. Make the base wide and gradually narrow it as you build upward. Use blue or light gray blocks to give it a realistic appearance.",
      metadata: { type: 'building', tags: ['minecraft', 'tornado', 'structure'] }
    },
    // General knowledge about tornadoes (medium relevance to tornado queries)
    {
      text: "Tornadoes are violent rotating columns of air that extend from a thunderstorm to the ground. They can cause extensive damage with wind speeds that can exceed 300 mph.",
      metadata: { type: 'knowledge', tags: ['weather', 'tornado', 'science'] }
    },
    // Building structures in general (low relevance to specific tornado queries)
    {
      text: "When building structures in Minecraft, it's important to plan your design first. Consider the materials, size, and purpose of your build before starting.",
      metadata: { type: 'gaming', tags: ['minecraft', 'building', 'planning'] }
    }
  ];
  
  // Store each memory
  console.log('\n[2] Storing test memories...');
  for (const memory of testMemories) {
    console.log(`Storing memory: "${memory.text.substring(0, 40)}..."`);
    const success = await memoryManager.storeMemory(memory.text, memory.metadata);
    if (success) {
      console.log('✓ Memory stored successfully');
    } else {
      console.error('× Failed to store memory');
    }
  }
  
  // Test queries with expected relevance levels
  const testQueries = [
    {
      text: "How do I build a tornado in Minecraft?",
      description: "Very High Relevance Query - Should match first memory above threshold"
    },
    {
      text: "What is a tornado?",
      description: "Medium Relevance Query - May match second memory depending on threshold"
    },
    {
      text: "How do I build in Minecraft?",
      description: "Low Relevance Query - Might match third memory with low threshold"
    }
  ];
  
  // Set up threshold tests
  const thresholds = [
    { name: "High (0.45)", value: 0.45 },
    { name: "Medium (0.70)", value: 0.70 },
    { name: "Low (0.50)", value: 0.50 }
  ];
  
  // Run tests
  console.log('\n[3] Testing memory retrieval with different thresholds...');
  
  for (const threshold of thresholds) {
    console.log(`\n--- Testing with ${threshold.name} threshold ---`);
    
    for (const query of testQueries) {
      console.log(`\nQuery: "${query.text}" (${query.description})`);
      
      const options = { 
        relevanceThreshold: threshold.value,
        fallbackThreshold: threshold.value // Set both thresholds the same to test pure threshold behavior
      };
      
      const results = await memoryManager.retrieveRelevantMemories(query.text, 5, options);
      
      // Analyze results
      if (results.includes("No relevant memories found")) {
        console.log(`× No memories found above ${threshold.value} threshold`);
      } else {
        console.log(`✓ Found memories above ${threshold.value} threshold`);
        
        // Extract and display relevance scores from results
        const matches = results.match(/\(Relevance: (\d+)%\)/g);
        if (matches) {
          const scores = matches.map(m => parseInt(m.match(/(\d+)/)[0])/100);
          console.log(`Relevance scores: ${scores.map(s => (s).toFixed(2)).join(', ')}`);
          
          // Verify threshold is respected
          const allAboveThreshold = scores.every(score => score >= threshold.value);
          if (allAboveThreshold) {
            console.log(`✓ All results respect the ${threshold.value} threshold`);
          } else {
            console.log(`× Some results are below the ${threshold.value} threshold!`);
          }
        }
      }
    }
  }
  
  // Clean up test collection
  console.log('\n[4] Cleaning up...');
  try {
    await qdrant.deleteCollection('threshold_test');
    console.log('✓ Deleted test collection');
  } catch (err) {
    console.error('× Error deleting collection:', err.message);
  }
  
  console.log('\n================================');
  console.log('HIGH THRESHOLD MEMORY TEST COMPLETE');
  console.log('================================');
}

// Run the test
testHighThresholdMemory().catch(err => {
  console.error('Test failed with error:', err);
});
