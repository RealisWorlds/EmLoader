# Memory System Documentation

## Overview

The memory system has been separated from the main prompter.js file into a dedicated `memory.js` module to improve code organization and maintainability. This document explains how to use the new memory system.

## Structure

The memory system now uses a dedicated `MemoryManager` class that handles all memory-related operations including:

- Memory storage
- Memory retrieval
- Memory modification
- Memory statistics

## Memory Format

Each memory is stored with rich structured metadata:

```javascript
{
    text: "The actual memory content",
    timestamp: "2025-03-13T20:00:00.000Z",
    last_accessed: "2025-03-13T20:30:00.000Z",
    access_count: 2,
    type: "general", // or "conversation", "fact", "preference", etc.
    importance: "medium", // "low", "medium", "high", "critical"
    source: "user_interaction", // where the memory came from
    entities: ["person_name", "location"], // key entities in the memory
    context: {
        conversation_id: "abc123",
        related_topic: "home_improvement"
    },
    related_memories: ["memory_id_1", "memory_id_2"],
    tags: ["important", "preference", "recurring_topic"]
}
```

## High Relevance Threshold

The system maintains a high relevance threshold (0.85) for memory retrieval to ensure only highly relevant memories are used in responses. This can be customized if needed.

## Usage Examples

### Storing a Memory

```javascript
await memory.storeMemory(
    "User prefers dark mode in all applications", 
    {
        type: "preference",
        importance: "high",
        entities: ["user", "dark_mode"],
        tags: ["ui_preference", "accessibility"]
    }
);
```

### Retrieving Relevant Memories

```javascript
const memories = await memory.retrieveRelevantMemories(
    "What theme does the user prefer?",
    5, // limit
    { type: "preference" } // optional filters
);
```

### Memory Statistics

```javascript
const stats = await memory.getMemoryStats();
console.log(stats); // Shows memory usage patterns
```

### Tagging System

```javascript
// Add tags to an existing memory
await memory.addTagsToMemory("memory_id_123", ["important", "follow_up"]);

// Search for memories by tags
const taggedMemories = await memory.searchMemoriesByTags(["important", "preference"]);
```

## Best Practices

1. Use specific memory types to organize information
2. Tag memories for easy retrieval by category
3. Set appropriate importance levels for better filtering
4. Include relevant entities and context information
5. Consider using related_memories to create knowledge graphs

## Integration with Prompter

The Prompter class now delegates all memory operations to the MemoryManager, making the code more modular and easier to maintain.
