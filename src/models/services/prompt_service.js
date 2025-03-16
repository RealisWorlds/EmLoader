/**
 * PromptService - Handles prompt preparation and replacement
 * Manages template variables and string replacement
 */
export class PromptService {
  constructor(profile) {
    this.profile = profile;
    this.agent = null;
  }
  
  /**
   * Set the agent reference
   * @param {Object} agent - Agent instance
   */
  setAgent(agent) {
    this.agent = agent;
  }
  
  /**
   * Prepare a conversation prompt
   * @param {Array} messages - Conversation messages
   * @returns {Promise<string>} Prepared prompt
   */
  async prepareConversationPrompt(messages) {
    if (!this.profile.conversing) {
      throw new Error('Conversation prompt template not found in profile');
    }
    
    let prompt = this.profile.conversing;
    return this.replaceStrings(prompt, messages, this.agent?.convo_examples);
  }
  
  /**
   * Prepare a code generation prompt
   * @param {Array} messages - Conversation messages
   * @returns {Promise<string>} Prepared prompt
   */
  async prepareCodePrompt(messages) {
    if (!this.profile.coding) {
      throw new Error('Code prompt template not found in profile');
    }
    
    let prompt = this.profile.coding;
    return this.replaceStrings(prompt, messages, this.agent?.coding_examples);
  }
  
  /**
   * Prepare a memory saving prompt
   * @param {Array} to_summarize - Messages to summarize
   * @returns {Promise<string>} Prepared prompt
   */
  async prepareMemorySavingPrompt(to_summarize) {
    if (!this.profile.saving_memory) {
      throw new Error('Memory saving prompt template not found in profile');
    }
    
    let prompt = this.profile.saving_memory;
    return this.replaceStrings(prompt, null, null, to_summarize);
  }
  
  /**
   * Prepare a prompt for goal setting
   * @param {Array} messages - Conversation messages
   * @param {Object} last_goals - Previous goals
   * @returns {Promise<string>} Prepared prompt
   */
  async prepareGoalSettingPrompt(messages, last_goals) {
    if (!this.profile.goal_setting) {
      throw new Error('Goal setting prompt template not found in profile');
    }
    
    let prompt = this.profile.goal_setting;
    return this.replaceStrings(prompt, messages, null, [], last_goals);
  }
  
  /**
   * Prepare a prompt for memory storage
   * @param {string} message - Message to process
   * @returns {Promise<string>} Prepared prompt
   */
  async prepareMemoryStoragePrompt(message) {
    if (!this.profile.memory_storage) {
      // Default memory storage prompt if not defined in profile
      const defaultPrompt = `You are ${this.agent?.name} and are processing your experience into memory to recall later. Add details that will help you remember the experience. When someone asks you about the past you need to write in a way where you will remember easily.
        """
        $EXPERIENCE
        """
        Don't explain your reasoning, just provide the memory directly.`;
      
      return this.replaceVariables(defaultPrompt, { EXPERIENCE: message });
    }
    
    let prompt = this.profile.memory_storage;
    const experienceContent = [{role: 'user', content: message}];
    return this.replaceStrings(prompt, experienceContent, null, experienceContent);
  }
  
  /**
   * Replace template variables in a prompt
   * @param {string} prompt - Template string
   * @param {Array} messages - Conversation messages
   * @param {Object} examples - Examples object
   * @param {Array} to_summarize - Messages to summarize
   * @param {Object} last_goals - Previous goals
   * @returns {Promise<string>} Processed prompt
   */
  async replaceStrings(prompt, messages, examples=null, to_summarize=[], last_goals=null) {
    if (!this.agent) {
      console.warn('Agent reference not set, some replacements may fail');
      return prompt;
    }
    
    try {
      prompt = prompt.replaceAll('$NAME', this.agent.name || 'Agent');

      if (prompt.includes('$STATS')) {
        try {
          let stats = await getCommand('!stats').perform(this.agent);
          prompt = prompt.replaceAll('$STATS', stats);
        } catch (error) {
          console.warn('Error replacing $STATS:', error);
          prompt = prompt.replaceAll('$STATS', 'Stats unavailable');
        }
      }
      
      if (prompt.includes('$INVENTORY')) {
        try {
          let inventory = await getCommand('!inventory').perform(this.agent);
          prompt = prompt.replaceAll('$INVENTORY', inventory);
        } catch (error) {
          console.warn('Error replacing $INVENTORY:', error);
          prompt = prompt.replaceAll('$INVENTORY', 'Inventory unavailable');
        }
      }
      
      if (prompt.includes('$ACTION')) {
        prompt = prompt.replaceAll('$ACTION', this.agent.actions?.currentActionLabel || 'No current action');
      }
      
      if (prompt.includes('$COMMAND_DOCS')) {
        try {
          const { getCommandDocs } = await import('../agent/commands/index.js');
          prompt = prompt.replaceAll('$COMMAND_DOCS', getCommandDocs());
        } catch (error) {
          console.warn('Error replacing $COMMAND_DOCS:', error);
          prompt = prompt.replaceAll('$COMMAND_DOCS', 'Command documentation unavailable');
        }
      }
      
      if (prompt.includes('$CODE_DOCS')) {
        try {
          // Try to find the code task if available
          const code_task_content = messages && messages.length > 0 
            ? messages.slice().reverse().find(msg =>
                msg.role !== 'system' && msg.content.includes('!newAction(')
              )?.content?.match(/!newAction\((.*?)\)/)?.[1] || ''
            : '';
            
          if (this.agent.skill_libary && code_task_content) {
            prompt = prompt.replaceAll(
              '$CODE_DOCS',
              await this.agent.skill_libary.getRelevantSkillDocs(
                code_task_content, 
                this.agent.settings?.relevant_docs_count || 5
              )
            );
          } else {
            const { getSkillDocs } = await import('../agent/library/index.js');
            prompt = prompt.replaceAll('$CODE_DOCS', getSkillDocs());
          }
        } catch (error) {
          console.warn('Error replacing $CODE_DOCS:', error);
          prompt = prompt.replaceAll('$CODE_DOCS', 'Code documentation unavailable');
        }
      }
      
      if (prompt.includes('$EXAMPLES') && examples !== null) {
        try {
          prompt = prompt.replaceAll('$EXAMPLES', await examples.createExampleMessage(messages));
        } catch (error) {
          console.warn('Error replacing $EXAMPLES:', error);
          prompt = prompt.replaceAll('$EXAMPLES', 'Examples unavailable');
        }
      }
      
      if (prompt.includes('$MEMORY')) {
        prompt = prompt.replaceAll('$MEMORY', this.agent.history?.memory || 'No memory available');
      }
      
      if (prompt.includes('$TO_SUMMARIZE')) {
        try {
          const { stringifyTurns } = await import('../utils/text.js');
          prompt = prompt.replaceAll('$TO_SUMMARIZE', stringifyTurns(to_summarize));
        } catch (error) {
          console.warn('Error replacing $TO_SUMMARIZE:', error);
          prompt = prompt.replaceAll('$TO_SUMMARIZE', 'Content to summarize unavailable');
        }
      }
      
      if (prompt.includes('$CONVO')) {
        try {
          const { stringifyTurns } = await import('../utils/text.js');
          prompt = prompt.replaceAll('$CONVO', 'Recent conversation:\n' + stringifyTurns(messages || []));
        } catch (error) {
          console.warn('Error replacing $CONVO:', error);
          prompt = prompt.replaceAll('$CONVO', 'Conversation unavailable');
        }
      }
      
      if (prompt.includes('$SELF_PROMPT')) {
        const selfPrompter = this.agent.self_prompter;
        let self_prompt = '';
        
        if (selfPrompter && !selfPrompter.isStopped()) {
          self_prompt = `YOUR CURRENT ASSIGNED GOAL: "${selfPrompter.prompt}"\n`;
        }
        
        prompt = prompt.replaceAll('$SELF_PROMPT', self_prompt);
      }
      
      if (prompt.includes('$LONG_TERM_MEMORY')) {
        try {
          if (messages && messages.length > 0) {
            const lastMessage = messages[messages.length - 1];
            const relevantMemories = await this.agent.prompter.retrieveRelevantMemories(lastMessage.content, 3);
            
            if (relevantMemories) {
              prompt = prompt.replaceAll('$LONG_TERM_MEMORY', relevantMemories);
            } else {
              prompt = prompt.replaceAll('$LONG_TERM_MEMORY', "No long-term memories available.");
            }
          } else {
            prompt = prompt.replaceAll('$LONG_TERM_MEMORY', "No long-term memories available.");
          }
        } catch (error) {
          console.error('Error handling $LONG_TERM_MEMORY placeholder:', error);
          prompt = prompt.replaceAll('$LONG_TERM_MEMORY', "Error retrieving long-term memories.");
        }
      }
      
      if (prompt.includes('$LAST_GOALS')) {
        let goal_text = '';
        for (let goal in last_goals) {
          if (last_goals[goal])
            goal_text += `You recently successfully completed the goal ${goal}.\n`
          else
            goal_text += `You recently failed to complete the goal ${goal}.\n`
        }
        prompt = prompt.replaceAll('$LAST_GOALS', goal_text.trim());
      }
      
      if (prompt.includes('$BLUEPRINTS')) {
        if (this.agent.npc?.constructions) {
          let blueprints = '';
          for (let blueprint in this.agent.npc.constructions) {
            blueprints += blueprint + ', ';
          }
          prompt = prompt.replaceAll('$BLUEPRINTS', blueprints.slice(0, -2));
        } else {
          prompt = prompt.replaceAll('$BLUEPRINTS', 'No blueprints available');
        }
      }
      
      // Support for $EXPERIENCE (used in memory prompts)
      if (prompt.includes('$EXPERIENCE') && to_summarize && to_summarize.length > 0) {
        try {
          const { stringifyTurns } = await import('../utils/text.js');
          prompt = prompt.replaceAll('$EXPERIENCE', stringifyTurns(to_summarize));
        } catch (error) {
          console.warn('Error replacing $EXPERIENCE:', error);
          prompt = prompt.replaceAll('$EXPERIENCE', 'Experience content unavailable');
        }
      }

      // Check for any remaining placeholders
      let remaining = prompt.match(/\$[A-Z_]+/g);
      if (remaining !== null) {
        console.warn('Unknown prompt placeholders:', remaining.join(', '));
      }
      
      return prompt;
    } catch (error) {
      console.error('Error in replaceStrings:', error);
      return prompt; // Return original prompt if replacement fails
    }
  }
  
  /**
   * Simple variable replacement
   * @param {string} text - Text to process
   * @param {Object} variables - Variable values
   * @returns {string} Processed text
   */
  replaceVariables(text, variables) {
    let result = text;
    for (const [key, value] of Object.entries(variables)) {
      result = result.replace(new RegExp(`\\$${key}`, 'g'), value);
    }
    return result;
  }
}
