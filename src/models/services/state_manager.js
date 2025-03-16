/**
 * StateManager - Implements a finite state machine for the Prompter system
 * Manages state transitions and callbacks for state changes
 */
export class StateManager {
  constructor() {
    // Define possible states
    this.STATES = {
      IDLE: 'idle',
      PROCESSING_CHAT: 'processing_chat',
      PROCESSING_CODE: 'processing_code',
      PROCESSING_MEMORY: 'processing_memory',
      ERROR: 'error',
      COOLDOWN: 'cooldown'
    };
    
    this.currentState = this.STATES.IDLE;
    this.stateData = {};
    this.stateTransitionHistory = [];
    this.transitionCallbacks = {};
  }
  
  /**
   * Get the current state of the system
   * @returns {string} Current state
   */
  getCurrentState() {
    return this.currentState;
  }
  
  /**
   * Check if a transition from current state to target state is valid
   * @param {string} fromState - Starting state
   * @param {string} toState - Target state
   * @returns {boolean} Whether transition is valid
   */
  canTransition(fromState, toState) {
    // Define valid transitions
    const validTransitions = {
      [this.STATES.IDLE]: [this.STATES.PROCESSING_CHAT, this.STATES.PROCESSING_CODE, this.STATES.PROCESSING_MEMORY],
      [this.STATES.PROCESSING_CHAT]: [this.STATES.IDLE, this.STATES.COOLDOWN, this.STATES.ERROR],
      [this.STATES.PROCESSING_CODE]: [this.STATES.IDLE, this.STATES.COOLDOWN, this.STATES.ERROR],
      [this.STATES.PROCESSING_MEMORY]: [this.STATES.IDLE, this.STATES.COOLDOWN, this.STATES.ERROR],
      [this.STATES.ERROR]: [this.STATES.IDLE],
      [this.STATES.COOLDOWN]: [this.STATES.IDLE]
    };
    
    return validTransitions[fromState]?.includes(toState) || false;
  }
  
  /**
   * Transition to a new state if valid
   * @param {string} toState - Target state
   * @param {Object} data - Additional data for the state transition
   * @returns {boolean} Whether transition was successful
   */
  transition(toState, data = {}) {
    const fromState = this.currentState;
    
    if (!this.canTransition(fromState, toState)) {
      console.warn(`Invalid state transition: ${fromState} -> ${toState}`);
      return false;
    }
    
    // Record transition in history
    this.stateTransitionHistory.push({
      from: fromState,
      to: toState,
      timestamp: Date.now(),
      data
    });
    
    // Update current state
    this.currentState = toState;
    this.stateData = data;
    
    // Execute callbacks
    if (this.transitionCallbacks[toState]) {
      this.transitionCallbacks[toState].forEach(callback => callback(fromState, data));
    }
    
    return true;
  }
  
  /**
   * Register a callback for a state transition
   * @param {string} state - State to watch for
   * @param {Function} callback - Function to call on transition
   */
  onTransition(state, callback) {
    if (!this.transitionCallbacks[state]) {
      this.transitionCallbacks[state] = [];
    }
    this.transitionCallbacks[state].push(callback);
  }
  
  /**
   * Reset the state machine to idle
   */
  reset() {
    this.transition(this.STATES.IDLE);
    this.stateData = {};
  }
  
  /**
   * Get history of state transitions
   * @param {number} limit - Maximum number of entries to return
   * @returns {Array} State transition history
   */
  getTransitionHistory(limit = 10) {
    return this.stateTransitionHistory.slice(-limit);
  }
}
