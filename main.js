import { AgentProcess } from './src/process/agent_process.js';
import settings from './settings.js';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { createMindServer } from './src/server/mind_server.js';
import { mainProxy } from './src/process/main_proxy.js';
import { readFileSync } from 'fs';
import net from 'net';

function parseArguments() {
    return yargs(hideBin(process.argv))
        .option('profiles', {
            type: 'array',
            describe: 'List of agent profile paths',
        })
        .option('task_path', {
            type: 'string',
            describe: 'Path to task file to execute'
        })
        .option('task_id', {
            type: 'string',
            describe: 'Task ID to execute'
        })
        .option('host_mindserver', {
            type: 'boolean',
            describe: 'Whether this instance should host the mindserver',
            default: settings.host_mindserver
        })
        .option('mindserver_port', {
            type: 'number',
            describe: 'Port for the mindserver',
            default: settings.mindserver_port
        })
        .help()
        .alias('help', 'h')
        .parse();
}

function getProfiles(args) {
    return args.profiles || settings.profiles;
}

// Function to check if a port is in use
function isPortInUse(port, host = 'localhost') {
    return new Promise((resolve) => {
        const server = net.createServer();
        
        server.once('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                resolve(true); // Port is in use
            } else {
                resolve(false); // Some other error
            }
        });
        
        server.once('listening', () => {
            // Close the server if it's listening
            server.close(() => {
                resolve(false); // Port is not in use
            });
        });
        
        server.listen(port, host);
    });
}

// Function to find an available port starting from the basePort
async function findAvailablePort(basePort, maxAttempts = 10) {
    let port = basePort;
    let attempts = 0;
    
    while (attempts < maxAttempts) {
        const inUse = await isPortInUse(port);
        if (!inUse) {
            return port;
        }
        port++;
        attempts++;
    }
    
    throw new Error(`Unable to find an available port after ${maxAttempts} attempts starting from ${basePort}`);
}

async function main() {
    const args = parseArguments();
    const shouldHostMindserver = args.host_mindserver;
    let mindserverPort = args.mindserver_port;
    
    // Check if the mindserver port is in use and only start it if needed
    if (shouldHostMindserver) {
        try {
            const portInUse = await isPortInUse(mindserverPort);
            if (portInUse) {
                console.log(`Mindserver port ${mindserverPort} is already in use.`);
                
                // Try to find an alternative port
                try {
                    const alternativePort = await findAvailablePort(mindserverPort + 1);
                    console.log(`Found alternative port ${alternativePort}. Using this instead.`);
                    mindserverPort = alternativePort;
                } catch (portFindError) {
                    console.error(`Failed to find an alternative port: ${portFindError.message}`);
                    console.log('This instance will not host the mindserver.');
                    shouldHostMindserver = false;
                }
            }
            
            if (shouldHostMindserver) {
                console.log(`Starting mindserver on port ${mindserverPort}...`);
                try {
                    const mindServer = createMindServer(mindserverPort);
                    console.log(`Mindserver successfully started on port ${mindserverPort}`);
                } catch (serverError) {
                    console.error(`Failed to start mindserver: ${serverError.message}`);
                }
            }
        } catch (error) {
            console.error(`Error checking port availability: ${error.message}`);
            console.log('This instance will not host the mindserver due to error.');
        }
    } else {
        console.log('Not hosting mindserver in this instance.');
    }
    
    mainProxy.connect();

    const profiles = getProfiles(args);
    console.log(profiles);
    const { load_memory, init_message } = settings;

    for (let i=0; i<profiles.length; i++) {
        const agent_process = new AgentProcess();
        const profile = readFileSync(profiles[i], 'utf8');
        const agent_json = JSON.parse(profile);
        mainProxy.registerAgent(agent_json.name, agent_process);
        agent_process.start(profiles[i], load_memory, init_message, i, args.task_path, args.task_id);
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
}

try {
    main();
} catch (error) {
    console.error('An error occurred:', error);
    process.exit(1);
}
