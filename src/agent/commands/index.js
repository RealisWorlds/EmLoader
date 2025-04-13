import { getBlockId, getItemId } from "../../utils/mcdata.js";
import { actionsList } from './actions.js';
import { queryList } from './queries.js';
import { actionStateCommands } from './action_state_commands.js';
import { logger } from '../../utils/logger.js';

let suppressNoDomainWarning = false;

const commandList = queryList.concat(actionsList).concat(actionStateCommands);
const commandMap = {};
for (let command of commandList) {
    commandMap[command.name] = command;
}

export function getCommand(name) {
    return commandMap[name];
}

export function blacklistCommands(commands) {
    const unblockable = ['!stop', '!stats', '!inventory', '!goal'];
    for (let command_name of commands) {
        if (unblockable.includes(command_name)){
            console.warn(`Command ${command_name} is unblockable`);
            continue;
        }
        delete commandMap[command_name];
        delete commandList.find(command => command.name === command_name);
    }
}

const commandRegex = /!(\w+)(?:\(((?:-?\d+(?:\.\d+)?|true|false|"[^"]*"|'[^']*')(?:\s*,\s*(?:-?\d+(?:\.\d+)?|true|false|"[^"]*"|'[^']*'))*)\))?/
const argRegex = /-?\d+(?:\.\d+)?|true|false|"[^"]*"|'[^']*'/g;

export function containsCommand(message) {
    // More robust command detection
    const lines = message.split('\n');
    for (const line of lines) {
        const commandMatch = line.match(commandRegex);
        if (commandMatch) {
            return "!" + commandMatch[1];
        }
    }
    return null;
}

export function truncCommandMessage(message) {
    const lines = message.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const commandMatch = lines[i].match(commandRegex);
        if (commandMatch) {
            // Return everything up to and including the command
            return lines.slice(0, i).join('\n') + 
                   (i > 0 ? '\n' : '') + 
                   lines[i].substring(0, commandMatch.index + commandMatch[0].length);
        }
    }
    return message;
}

export function commandExists(commandName) {
    if (!commandName.startsWith("!"))
        commandName = "!" + commandName;
    return commandMap[commandName] !== undefined;
}

/**
 * Converts a string into a boolean.
 * @param {string} input
 * @returns {boolean | null} the boolean or `null` if it could not be parsed.
 * */
function parseBoolean(input) {
    switch(input.toLowerCase()) {
        case 'false': //These are interpreted as flase;
        case 'f':
        case '0':
        case 'off':
            return false;
        case 'true': //These are interpreted as true;
        case 't':
        case '1':
        case 'on':
            return true;
        default:
            return null;
    }
}

/**
 * @param {number} value - the value to check
 * @param {number} lowerBound
 * @param {number} upperBound
 * @param {string} endpointType - The type of the endpoints represented as a two character string. `'[)'` `'()'` 
 */
function checkInInterval(number, lowerBound, upperBound, endpointType) {
    switch (endpointType) {
        case '[)':
            return lowerBound <= number && number < upperBound;
        case '()':
            return lowerBound < number && number < upperBound;
        case '(]':
            return lowerBound < number && number <= upperBound;
        case '[]':
            return lowerBound <= number && number <= upperBound;
        default:
            throw new Error('Unknown endpoint type:', endpointType)
    }
}



// todo: handle arrays?
/**
 * Returns an object containing the command, the command name, and the comand parameters.
 * If parsing unsuccessful, returns an error message as a string.
 * @param {string} message - A message from a player or language model containing a command.
 * @returns {string | Object}
 */
export function parseCommandMessage(message) {
    const commandMatch = message.match(commandRegex);
    if (!commandMatch) return `Command is incorrectly formatted`;

    const commandName = "!"+commandMatch[1];

    let args;
    let parsedArgs = [];
    
    
    
    if (commandMatch[2]) args = commandMatch[2].match(argRegex);
    else args = [];

    const command = getCommand(commandName);
    if(!command) return `${commandName} is not a command.`

    const params = commandParams(command);
    const paramNames = commandParamNames(command);
    
    // Check if arguments and parameters don't match
    if (args.length !== params.length) {
        // Attempt to correct the syntax by inspecting the full message
        const correctedArgs = attemptArgumentRecovery(message, commandName, params);
        
        if (correctedArgs && correctedArgs.length === params.length) {
            DEBUG.info(`Recovered arguments for ${commandName}: ${correctedArgs.join(', ')}`);
            args = correctedArgs;
        } else {
            return `Command ${command.name} was given ${args.length} args, but requires ${params.length} args.`;
        }
    }
    
    for (let i = 0; i < args.length; i++) {
        const param = params[i];
        //Remove any extra characters
        let arg = args[i].trim();
        if ((arg.startsWith('"') && arg.endsWith('"')) || (arg.startsWith("'") && arg.endsWith("'"))) {
            arg = arg.substring(1, arg.length-1);
        }
        
        //Convert to the correct type
        switch(param.type) {
            case 'int':
                arg = Number.parseInt(arg); break;
            case 'float':
                arg = Number.parseFloat(arg); break;
            case 'boolean':
                arg = parseBoolean(arg); break;
            case 'BlockName':
            case 'ItemName':
                if (arg.endsWith('plank'))
                    arg += 's'; // catches common mistakes like "oak_plank" instead of "oak_planks"
            case 'string':
                break;
            default:
                throw new Error(`Command '${commandName}' parameter '${paramNames[i]}' has an unknown type: ${param.type}`);
        }
        if(arg === null || Number.isNaN(arg))
            return `Error: Param '${paramNames[i]}' must be of type ${param.type}.`

        if(typeof arg === 'number') { //Check the domain of numbers
            const domain = param.domain;
            if(domain) {
                /**
                 * Javascript has a built in object for sets but not intervals.
                 * Currently the interval (lowerbound,upperbound] is represented as an Array: `[lowerbound, upperbound, '(]']`
                 */
                if (!domain[2]) domain[2] = '[)'; //By default, lower bound is included. Upper is not.

                if(!checkInInterval(arg, ...domain)) {
                    return `Error: Param '${paramNames[i]}' must be an element of ${domain[2][0]}${domain[0]}, ${domain[1]}${domain[2][1]}.`;
                    //Alternatively arg could be set to the nearest value in the domain.
                }
            } else if (!suppressNoDomainWarning) {
                console.warn(`Command '${commandName}' parameter '${paramNames[i]}' has no domain set. Expect any value [-Infinity, Infinity].`)
                suppressNoDomainWarning = true; //Don't spam console. Only give the warning once.
            }
        } else if(param.type === 'BlockName') { //Check that there is a block with this name
            if(getBlockId(arg) == null && arg !== 'air') return  `Invalid block type: ${arg}.`
        } else if(param.type === 'ItemName') { //Check that there is an item with this name
            if(getItemId(arg) == null) return `Invalid item type: ${arg}.`
        }
        parsedArgs[i] = arg;
    }
    
    return { commandName, args: parsedArgs };
}

export function isAction(name) {
    return actionsList.find(action => action.name === name) !== undefined;
}

/**
 * @param {Object} command
 * @returns {Object[]} The command's parameters.
 */
function commandParams(command) {
    if (!command.params)
        return [];
    return Object.values(command.params);
}

/**
 * @param {Object} command
 * @returns {string[]} The names of the command's parameters.
 */
function commandParamNames(command) {
    if (!command.params)
        return [];
    return Object.keys(command.params);
}

function numParams(command) {
    return commandParams(command).length;
}

export async function executeCommand(agent, message) {
    let parsed = parseCommandMessage(message);
    if (typeof parsed === 'string')
        return parsed; //The command was incorrectly formatted or an invalid input was given.
    else {
        logger.debug('parsed command:', parsed);
        const command = getCommand(parsed.commandName);
        let numArgs = 0;
        if (parsed.args) {
            numArgs = parsed.args.length;
        }
        if (numArgs !== numParams(command))
            return `Command ${command.name} was given ${numArgs} args, but requires ${numParams(command)} args.`;
        else {
            // Check if we have this command cached in Qdrant first
            if (agent.prompter && agent.prompter.vectorClient) {
                try {
                    // Create a unique key for this command and its arguments
                    const commandKey = `${command.name}:${parsed.args ? parsed.args.join(',') : ''}`;
                    logger.debug(`Checking for cached command: ${commandKey}`);
                    
                    // Try to retrieve the cached result
                    const cachedResult = await retrieveCachedCommand(agent.prompter.vectorClient, 
                                                                     agent.prompter.collectionName + "_actions", 
                                                                     commandKey);
                    
                    if (cachedResult) {
                        logger.debug(`Found cached result for command: ${commandKey}`);
                        return cachedResult;
                    } else {
                        logger.debug(`No cached result found for command: ${commandKey}`);
                    }
                } catch (error) {
                    console.error('Error checking command cache:', error);
                    // Continue with normal execution if cache check fails
                }
            }
            
            // Execute the command normally
            let result = await command.perform(agent, ...parsed.args);
            if (typeof result === 'boolean') {
                result = result ? 'Success running ' + command.name : 'Possible failure running ' + command.name;
            }
            logger.debug("result", result);
            // Cache the result for future use
            if (agent.prompter && agent.prompter.vectorClient && result) {
                try {
                    const commandKey = `${command.name}:${parsed.args ? parsed.args.join(',') : ''}`;
                    await cacheCommandResult(agent.prompter.vectorClient, 
                                           agent.prompter.collectionName + "_actions", 
                                           commandKey, 
                                           result);
                } catch (error) {
                    console.error('Error caching command result:', error);
                }
            }
            
            return result;
        }
    }
}

function getBotOutputSummary() {
    const { bot } = this.agent;
    if (bot.interrupt_code && !this.timedout) return '';
    let output = bot.output;
    const MAX_OUT = 500;
    if (output.length > MAX_OUT) {
        output = `Action output is very long (${output.length} chars) and has been shortened.\n
      First outputs:\n${output.substring(0, MAX_OUT / 2)}\n...skipping many lines.\nFinal outputs:\n ${output.substring(output.length - MAX_OUT / 2)}`;
    }
    else {
        output = 'Action output:\n' + output.toString();
    }
    bot.output = '';
    return output;
}

function attemptArgumentRecovery(message, commandName, params) {
    try {
        // If no parameters are expected, return empty array
        if (params.length === 0) return [];
        
        // Look for common argument patterns
        
        // Pattern 1: Single quotes instead of double quotes
        // Example: !goToPlayer('acdxz', 3)
        const singleQuotePattern = new RegExp(`${commandName.replace('!', '\\!')}\\s*\\(\\s*'([^']+)'\\s*,\\s*([^)]+)\\s*\\)`);
        const singleQuoteMatch = message.match(singleQuotePattern);
        
        if (singleQuoteMatch && singleQuoteMatch.length >= 3) {
            // Convert to our expected format
            return [
                `"${singleQuoteMatch[1]}"`,
                singleQuoteMatch[2].trim()
            ];
        }
        
        // Pattern 2: No quotes around string arguments
        // Example: !goToPlayer(acdxz, 3)
        const noQuotesPattern = new RegExp(`${commandName.replace('!', '\\!')}\\s*\\(\\s*([a-zA-Z0-9_]+)\\s*,\\s*([^)]+)\\s*\\)`);
        const noQuotesMatch = message.match(noQuotesPattern);
        
        if (noQuotesMatch && noQuotesMatch.length >= 3) {
            return [
                `"${noQuotesMatch[1]}"`,
                noQuotesMatch[2].trim()
            ];
        }
        
        // Pattern 3: Arguments without parentheses
        // Example: !goToPlayer acdxz 3
        const noParenesPattern = new RegExp(`${commandName.replace('!', '\\!')}\\s+([a-zA-Z0-9_"']+)\\s+([0-9.]+)`);
        const noParensMatch = message.match(noParenesPattern);
        
        if (noParensMatch && noParensMatch.length >= 3) {
            let arg1 = noParensMatch[1];
            // Add quotes if needed
            if (!arg1.startsWith('"') && !arg1.startsWith("'")) {
                arg1 = `"${arg1}"`;
            }
            return [arg1, noParensMatch[2].trim()];
        }
        
        // Pattern 4: Try to extract arguments by position after command
        // This is a more general fallback approach
        const commandPosition = message.indexOf(commandName);
        if (commandPosition !== -1) {
            const afterCommand = message.substring(commandPosition + commandName.length).trim();
            
            // If we're expecting string parameters
            if (params[0].type === 'string') {
                // Look for strings that might be arguments
                const potentialArgs = afterCommand.match(/(['"][^'"]+['"]|[a-zA-Z0-9_]+)/g);
                if (potentialArgs && potentialArgs.length >= params.length) {
                    return potentialArgs.slice(0, params.length).map(arg => {
                        // Add quotes to strings if missing
                        if (arg.startsWith('"') || arg.startsWith("'")) {
                            return arg;
                        } else {
                            return `"${arg}"`;
                        }
                    });
                }
            }
            
            // For numeric parameters, try to find numbers
            if (params[0].type === 'int' || params[0].type === 'float') {
                const numberArgs = afterCommand.match(/[-+]?[0-9]*\.?[0-9]+/g);
                if (numberArgs && numberArgs.length >= params.length) {
                    return numberArgs.slice(0, params.length);
                }
            }
        }
        
        // Recovery failed
        return null;
    } catch (err) {
        console.error('Error in argument recovery:', err);
        return null;
    }
}

// Function to retrieve a cached command from Qdrant
async function retrieveCachedCommand(client, collectionName, commandKey) {
    try {
        // Check if collection exists first
        try {
            await client.getCollection(collectionName);
        } catch (error) {
            // Collection doesn't exist yet
            logger.debug(`Command cache collection ${collectionName} doesn't exist yet`);
            return null;
        }
        
        // Search for the exact command key
        const results = await client.scroll(collectionName, {
            filter: {
                must: [
                    {
                        key: "commandKey",
                        match: {
                            value: commandKey
                        }
                    }
                ]
            },
            limit: 1
        });
        
        if (results && results.points && results.points.length > 0) {
            const cachedCommand = results.points[0];
            if (cachedCommand.payload && cachedCommand.payload.result) {
                return cachedCommand.payload.result;
            }
        }
        return null;
    } catch (error) {
        console.error('Error retrieving cached command:', error);
        return null;
    }
}

// Function to cache a command result in Qdrant
async function cacheCommandResult(client, collectionName, commandKey, result) {
    try {
        // Check if collection exists, create if it doesn't
        try {
            await client.getCollection(collectionName);
            logger.debug(`Command cache collection ${collectionName} already exists.`);
        } catch (error) {
            // Collection doesn't exist, create it
            logger.debug(`Creating command cache collection ${collectionName}`);
            await client.createCollection(collectionName, {
                vectors: {
                    size: 4,  // Small vector size since we're using exact matching
                    distance: 'Dot'
                }
            });
        }
        
        // Generate a unique ID
        const id = Date.now() + Math.floor(Math.random() * 1000);
        
        // Store command with result
        await client.upsert(collectionName, {
            points: [{
                id: id,
                vector: [0.1, 0.2, 0.3, 0.4],  // Placeholder vector since we're using exact matching
                payload: {
                    commandKey: commandKey,
                    result: result,
                    timestamp: new Date().toISOString()
                }
            }]
        });
        
        logger.debug(`Cached command result for: ${commandKey}`);
        return true;
    } catch (error) {
        console.error('Error caching command result:', error);
        return false;
    }
}

export function getCommandDocs() {
    const typeTranslations = {
        //This was added to keep the prompt the same as before type checks were implemented.
        //If the language model is giving invalid inputs changing this might help.
        'float':        'number',
        'int':          'number',
        'BlockName':    'string',
        'ItemName':     'string',
        'boolean':      'bool'
    }
    let docs = `\n*COMMAND DOCS\n You can use the following commands to perform actions and get information about the world. 
    Use the commands with the syntax: !commandName or !commandName("arg1", 1.2, ...) if the command takes arguments.\n
    Do not use codeblocks. Use double quotes for strings. Only use one command in each response, trailing commands and comments will be ignored.\n`;
    for (let command of commandList) {
        docs += command.name + ': ' + command.description + '\n';
        if (command.params) {
            docs += 'Params:\n';
            for (let param in command.params) {
                docs += `${param}: (${typeTranslations[command.params[param].type]??command.params[param].type}) ${command.params[param].description}\n`;
            }
        }
    }
    return docs + '*\n';
}
