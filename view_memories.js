// Simple utility to view memories from Qdrant
import fetch from 'node-fetch';

const COLLECTION_NAME = 'BobVilaAI_memories';
const QDRANT_URL = 'http://localhost:6333';
const LIMIT = 50; // Number of memories to retrieve

async function fetchMemories() {
  try {
    console.log(`Fetching memories from collection: ${COLLECTION_NAME}\n`);
    
    const response = await fetch(`${QDRANT_URL}/collections/${COLLECTION_NAME}/points/scroll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        limit: LIMIT,
        with_payload: true,
        with_vectors: false
      })
    });
    
    const data = await response.json();
    
    if (data.status !== 'ok' || !data.result || !data.result.points) {
      console.error('Error fetching memories:', data);
      return;
    }
    
    console.log(`Found ${data.result.points.length} memories:\n`);
    
    // Display each memory
    data.result.points.forEach((point, index) => {
      console.log(`--- Memory #${index + 1} ---`);
      console.log(`ID: ${point.id}`);
      console.log(`Text: ${point.payload.text}`);
      console.log(`Timestamp: ${new Date(point.payload.timestamp).toLocaleString()}`);
      console.log(`Importance: ${point.payload.importance || 'not specified'}`);
      console.log(`Source: ${point.payload.source || 'not specified'}`);
      console.log('-------------------\n');
    });
    
    if (data.result.next_page_offset) {
      console.log(`More memories available. Run again with 'offset' parameter to see more.`);
    }
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

fetchMemories();
