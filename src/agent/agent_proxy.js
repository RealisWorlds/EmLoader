import { io } from 'socket.io-client';
import convoManager from './conversation.js';
import settings from '../../settings.js';
import { logger } from '../utils/logger.js';

class AgentServerProxy {
    constructor() {
        if (AgentServerProxy.instance) {
            return AgentServerProxy.instance;
        }
        
        this.socket = null;
        this.connected = false;
        AgentServerProxy.instance = this;
    }

    connect(agent) {
        if (this.connected) return;
        
        this.agent = agent;

        this.socket = io(`http://${settings.mindserver_host}:${settings.mindserver_port}`);
        this.connected = true;

        this.socket.on('connect', () => {
            logger.debug('Connected to MindServer');
        });

        this.socket.on('disconnect', () => {
            logger.debug('Disconnected from MindServer');
            this.connected = false;
        });

        this.socket.on('agents-update', (agents) => {
            convoManager.updateAgents(agents);
        });

        this.socket.on('restart-agent', (agentName) => {
            logger.debug(`Restarting agent: ${agentName}`);
            this.agent.cleanKill();
        });
    }

    login() {
        this.socket.emit('login-agent', this.agent.name);
    }

    shutdown() {
        this.socket.emit('shutdown');
    }

    getSocket() {
        return this.socket;
    }
}

// Create and export a singleton instance
export const serverProxy = new AgentServerProxy();
