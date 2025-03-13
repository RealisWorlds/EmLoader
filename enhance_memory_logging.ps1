# PowerShell script to enhance memory logging in prompter.js
# Created to work around edit_file connection issues

# Read the prompter.js file
$prompterPath = "c:\mdcraft1\mindcraft\src\models\prompter.js"
$content = Get-Content $prompterPath -Raw

# Enhancement 1: Update retrieveRelevantMemories method beginning
$originalPattern1 = '(?s)async retrieveRelevantMemories\(query, limit = 10\) \{.*?try \{.*?console\.log\(`Retrieving memories relevant to: "\$\{query\.substring\(0, 100\)\}\.\.\."`\);'
$replacement1 = @"
async retrieveRelevantMemories(query, limit = 10) {
        if (!this.vectorClient || !this.embedding_model) {
            console.warn('Cannot retrieve memories: Vector client or embedding model not available');
            return "No long-term memories available.";
        }
        
        try {
            console.log(`\n=== VECTOR MEMORY SEARCH START ===`);
            console.log(`Retrieving memories relevant to: "\${query}"`);
"@
$content = $content -replace $originalPattern1, $replacement1

# Enhancement 2: Update search results section
$originalPattern2 = '(?s)console\.log\(`Found \$\{searchResults\?\.length \|\| 0\} memories`\);.*?searchResults\.forEach\(\(result, index\) => \{.*?const score = result\.score\.toFixed\(2\);.*?console\.log\(`Memory \$\{index \+ 1\}: Score: \$\{score\}, Text: "\$\{memory\.substring\(0, 50\)\}\.\.\."`\);'
$replacement2 = @"
console.log(`\n=== FOUND \${searchResults?.length || 0} MEMORIES ===`);
            
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
                
                console.log(`\nMEMORY \${index + 1}:`);
                console.log(`Score: \${score}`);
                console.log(`Time: \${timestamp}`);
                console.log(`Full Text: "\${memory}"`);
"@
$content = $content -replace $originalPattern2, $replacement2

# Enhancement 3: Update $LONG_TERM_MEMORY section
$originalPattern3 = 'if \(prompt\.includes\('\''\\$LONG_TERM_MEMORY'\''\) && messages && messages\.length > 0\) \{.*?const lastMessage = messages\[messages\.length - 1\];.*?const relevantMemories = await this\.retrieveRelevantMemories\(lastMessage\.content, 3\);.*?prompt = prompt\.replaceAll\('\''\\$LONG_TERM_MEMORY'\'', relevantMemories\);.*?\}'
$replacement3 = @"
if (prompt.includes('\$LONG_TERM_MEMORY') && messages && messages.length > 0) {
            const lastMessage = messages[messages.length - 1];
            console.log(`\n=== RETRIEVING MEMORIES BASED ON LAST MESSAGE: "\${lastMessage.content}" ===`);
            const relevantMemories = await this.retrieveRelevantMemories(lastMessage.content, 3);
            console.log(`\n=== REPLACING \$LONG_TERM_MEMORY IN PROMPT ===`);
            prompt = prompt.replaceAll('\$LONG_TERM_MEMORY', relevantMemories);
        }
"@
$content = $content -replace $originalPattern3, $replacement3

# Enhancement 4: Add a log after memory search is complete
$originalPattern4 = 'formattedResults \+= `Timestamp: \$\{timestamp\}\\n\\n`;.*?\}\);'
$replacement4 = @"
formattedResults += `Timestamp: \${timestamp}\n\n`;
            });
            
            console.log("\n=== VECTOR MEMORY SEARCH COMPLETE ===");
"@
$content = $content -replace $originalPattern4, $replacement4

# Write the modified content back to prompter.js
Set-Content -Path $prompterPath -Value $content

Write-Host "Memory logging enhancements have been successfully applied to prompter.js!"
