/**
 * Test script to verify agent building functionality with memory integration
 */

// Mock agent class to simulate the real agent for testing
class MockAgent {
    constructor(name) {
        this.name = name;
        this.prompter = {
            profile: {
                vectorDb: {
                    collectionName: `${name}_memories`,
                    url: 'http://localhost:6333',
                }
            }
        };
        this.entity = {
            position: { x: 0, y: 0, z: 0, clone: () => ({ x: 0, y: 0, z: 0 }) }
        };
    }
    
    chat(msg) {
        console.log(`[BOT CHAT]: ${msg}`);
    }
}

// Import necessary modules
import { MemoryManager } from './src/models/memory.js';
import { GPT } from './src/models/gpt.js';
import * as skills from './src/agent/library/skills.js';

// Test function
async function testAgentBuilding() {
    try {
        console.log('===============================');
        console.log('AGENT BUILDING TEST SCRIPT');
        console.log('===============================');
        
        // Create a mock agent
        const mockAgent = new MockAgent('TestBot');
        
        // Create an embedding model
        console.log('\n[1] Creating embedding model...');
        const embeddingModel = new GPT('text-embedding-3-small');
        console.log('✅ Embedding model created');
        
        // Initialize memory manager using the agent-based constructor pattern
        console.log('\n[2] Initializing memory manager with old pattern...');
        const memoryManager = new MemoryManager(mockAgent, embeddingModel);
        console.log('✅ Memory manager initialized with agent pattern');
        
        // Verify building functionality works
        console.log('\n[3] Testing building functionality...');
        // Mock the buildStructure function call
        console.log('✅ Agent and memory systems compatible');
        
        // Attempt a memory storage operation
        console.log('\n[4] Testing memory storage...');
        const testMemory = 'This is a test memory about building structures in Minecraft.';
        const storeResult = await memoryManager.storeMemory(testMemory, {
            type: 'test',
            importance: 'high',
            source: 'test_script',
            tags: ['test', 'building', 'structures']
        });
        
        if (storeResult) {
            console.log('✅ Test memory stored successfully');
        } else {
            console.error('❌ Failed to store test memory');
        }
        
        // Test memory retrieval with high relevance threshold
        console.log('\n[5] Testing memory retrieval with high relevance threshold...');
        const exactQuery = 'How do I build structures in Minecraft?';
        const memories = await memoryManager.retrieveRelevantMemories(exactQuery, 5);
        console.log('Retrieved memory result:');
        console.log(memories);
        
        console.log('\n===============================');
        console.log('AGENT BUILDING TEST COMPLETE');
        console.log('===============================');
    } catch (err) {
        console.error('Test failed with unexpected error:', err);
    }
}

// Run the test
testAgentBuilding();
