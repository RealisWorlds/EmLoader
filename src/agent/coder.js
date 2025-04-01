import { writeFile, readFile, mkdirSync } from 'fs';
import settings from '../../settings.js';
import { makeCompartment } from './library/lockdown.js';
import * as skills from './library/skills.js';
import * as world from './library/world.js';
import { Vec3 } from 'vec3';
import {ESLint} from "eslint";

export class Coder {
    constructor(agent) {
        this.agent = agent;
        this.file_counter = 0;
        this.fp = '/bots/'+agent.name+'/action-code/';
        this.generating = false;
        this.code_template = '';
        this.code_lint_template = '';
        this.actionLabel = '';

        readFile('./bots/execTemplate.js', 'utf8', (err, data) => {
            if (err) throw err;
            this.code_template = data;
        });
        readFile('./bots/lintTemplate.js', 'utf8', (err, data) => {
            if (err) throw err;
            this.code_lint_template = data;
        });
        mkdirSync('.' + this.fp, { recursive: true });
    }
    
    async lintCode(code) {
        if (!code || typeof code !== 'string') {
            return 'Invalid code input: code must be a non-empty string';
        }
    
        try {
            let result = '#### CODE ERROR INFO ###\n';
            
            // Extract skills and world function calls
            const skillRegex = /(?:skills|world)\.([\w]+)\(/g;
            const skillCalls = new Set();
            let match;
            
            while ((match = skillRegex.exec(code)) !== null) {
                if (match[1]) {
                    skillCalls.add(match[1]);
                }
            }
            
            // Convert to array for filtering
            const skillsArray = Array.from(skillCalls);
            
            // Validate that skills exist
            try {
                const allDocs = await this.agent.prompter.skill_libary.getAllSkillDocs();
                
                if (!allDocs) {
                    console.warn('Warning: Skill documentation unavailable');
                } else {
                    // Find skills that don't exist in documentation
                    const missingSkills = skillsArray.filter(skill => !!allDocs[skill]);
                    
                    if (missingSkills.length > 0) {
                        result += 'These functions do not exist. Please modify the correct function name and try again.\n';
                        result += '### FUNCTIONS NOT FOUND ###\n';
                        result += missingSkills.join('\n');
                        return result;
                    }
                }
            } catch (skillError) {
                console.error('Error checking skill documentation:', skillError);
                // Continue with linting even if skill check fails
            }

            const directApiRegex = /bot\.(placeBlock|dig|equip|activateBlock|pathfinder)/g;
            const directApiCalls = [];
            let dApiMatch;
            while ((dApiMatch = directApiRegex.exec(code)) !== null) {
                directApiCalls.push(dApiMatch[1]);
            }

            if (directApiCalls.length > 0) {
                result += 'Using direct Mineflayer APIs is not allowed. Please use the skills library instead:\n';
                directApiCalls.forEach(apiCall => {
                    result += `- Replace bot.${apiCall}() with skills.${apiCall}() or another appropriate skills function\n`;
                });
                return result;
            }
    
            // Perform ESLint validation
            try {
                const eslint = new ESLint();
                const results = await eslint.lintText(code);
                
                // Safely split code into lines
                const codeLines = code.split('\n');
                
                // Extract and format all lint errors
                const exceptions = results.flatMap(r => r.messages || []);
    
                if (exceptions.length > 0) {
                    let errorCount = 0;
                    
                    for (const exc of exceptions) {
                        // Only process valid exceptions with line and column info
                        if (exc && typeof exc.line === 'number' && typeof exc.column === 'number') {
                            errorCount++;
                            
                            // Safely retrieve the error line
                            let errorLine = 'Unable to retrieve error line content';
                            if (exc.line > 0 && exc.line <= codeLines.length) {
                                errorLine = codeLines[exc.line - 1]?.trim() || errorLine;
                            }
                            
                            result += `#ERROR ${errorCount}\n`;
                            result += `Message: ${exc.message || 'Unknown error'}\n`;
                            result += `Location: Line ${exc.line}, Column ${exc.column}\n`;
                            result += `Related Code Line: ${errorLine}\n\n`;
                        }
                    }
                    
                    result += 'The code contains exceptions and cannot continue execution.';
                    return result;
                } else {
                    return null; // No errors found
                }
            } catch (lintError) {
                console.error('ESLint execution error:', lintError);
                return `ESLint error: ${lintError.message || 'Unknown linting error occurred'}`;
            }
        } catch (unexpectedError) {
            console.error('Unexpected error in lintCode:', unexpectedError);
            return `Unexpected error during code linting: ${unexpectedError.message || String(unexpectedError)}`;
        }
    }

    // Fixed instrumentation that carefully handles for loops to avoid syntax errors
    fixedInstrumentCode(code) {
        // First step: Fully extract and protect for loops
        let processedCode = code;
        const forLoopRegex = /for\s*\(\s*(?:[^;]*?;)\s*(?:[^;]*?;)\s*(?:[^)]*?)\s*\)/g;
        
        // Replace for loops with placeholders
        let forLoops = [];
        let forLoopCounter = 0;
        
        processedCode = processedCode.replace(forLoopRegex, (match) => {
            const placeholder = `___FOR_LOOP_${forLoopCounter}___`;
            forLoops.push({
                placeholder,
                original: match
            });
            forLoopCounter++;
            return placeholder;
        });
        
        // Now add interrupt checks after each semicolon in the rest of the code
        processedCode = processedCode.replace(/;/g, '; if(check_interrupts()) { return {success: false, message: "Code interrupted", interrupted: true, timedout: false}; }\n');
        
        // Restore the for loops
        for (const loop of forLoops) {
            processedCode = processedCode.replace(loop.placeholder, loop.original);
        }

        const actionLabelText = `const actionLabel = "${this.actionLabel}";`;

        // add check interrupts function
        const checkIntFunc = `function check_interrupts() {
            if (!bot || !bot.interrupt_code) { return false; }
            log(bot, "Interrupt found, code interrupted");
            // Clear the interrupt code
            bot.interrupt_code = false;
            return true;
        }`;
        const returnFunc = `return {success: true, message: "Code completed successfully", interrupted: false, timedout: false};`;
        processedCode = actionLabelText + '\n' + checkIntFunc + '\n' + processedCode + '\n' + returnFunc;
        
        return processedCode;
    }

    // Helper function to protect for loops from being broken by semicolon replacement
    // Helper function to protect for loops
    protectForLoops(code) {
        let modifiedCode = code;
        const forLoopRegex = /for\s*\(([^)]*)\)/g;
        const forLoops = [];
        let match;
        
        while ((match = forLoopRegex.exec(code)) !== null) {
            forLoops.push({
                fullMatch: match[0],
                declaration: match[1],
                index: match.index
            });
        }
        
        for (const loop of forLoops) {
            const withMarkers = loop.declaration.replace(/;/g, '###SEMICOLON###');
            const newForLoop = `for (${withMarkers})`;
            modifiedCode = modifiedCode.replace(loop.fullMatch, newForLoop);
        }
        
        return modifiedCode;
    }
    
    async stageCode(code) {
        if (!code) {
            return { 
                func: null, 
                message: 'No code provided',
                success: false,
                interrupted: false,
                timedout: false
            };
        }
        try {
            code = this.sanitizeCode(code);
            let src = '';
            code = code.replaceAll('console.log(', 'log(bot,');
            code = code.replaceAll('log("', 'log(bot,"');

            // Process the code with fixed instrumentation
            const instrumentedCode = this.fixedInstrumentCode(code);

            console.log(`Generated code: """${instrumentedCode}"""`);

            // this may cause problems in callback functions
            for (let line of instrumentedCode.split('\n')) {
                src += `    ${line}\n`;
            }
            let src_lint_copy = this.code_lint_template.replace('/* CODE HERE */', src);
            src = this.code_template.replace('/* CODE HERE */', src);

            let filename = this.file_counter + '.js';
            this.agent.bot.codeFilePath = filename;
            this.file_counter++;
            
            try {
                let write_result = await this.writeFilePromise('.' + this.fp + filename, src);
                if (write_result) {
                    console.error('Error writing code execution file: ' + result);
                    return null;
                }
            } catch (writeError) {
                console.error('Error writing code to file:', writeError);
                return { 
                    func: null, 
                    message: 'Failed to write code to file: ' + writeError.message,
                    success: false,
                    interrupted: false,
                    timedout: false
                };
            }
            // This is where we determine the environment the agent's code should be exposed to.
            // It will only have access to these things, (in addition to basic javascript objects like Array, Object, etc.)
            // Note that the code may be able to modify the exposed objects.

            // Execute in compartment with proper error handling
            try {
                const compartment = makeCompartment({
                    skills,
                    log: skills.log,
                    world,
                    Vec3,
                });
                
                const mainFn = await compartment.evaluate(src);
                return { 
                    func: { main: mainFn }, 
                    src_lint_copy: src_lint_copy,
                    success: true,
                    message: 'Code staged successfully',
                    interrupted: false,
                    timedout: false
                };
            } catch (compartmentError) {
                console.error('Compartment execution error:', compartmentError);
                
                // Extract a clean error message
                let errMessage = compartmentError.message || String(compartmentError);
                if (errMessage) {
                    // Take substring until a newline for cleaner output
                    errMessage = errMessage.split('\n')[0];
                }
                
                return { 
                    func: null, 
                    message: 'Compartment execution error: ' + errMessage,
                    success: false,
                    interrupted: false,
                    timedout: false
                };
            }
        } catch (unexpectedError) {
            console.error('Unexpected error in stageCode:', unexpectedError);
            return { 
                func: null, 
                message: 'Unexpected error: ' + (unexpectedError.message || String(unexpectedError)),
                success: false,
                interrupted: false,
                timedout: false
            };
        }
    }

    sanitizeCode(code) {
        code = code.trim();
        const remove_strs = ['Javascript', 'javascript', 'js']
        for (let r of remove_strs) {
            if (code.startsWith(r)) {
                code = code.slice(r.length);
                return code;
            }
        }
        return code;
    }

    writeFilePromise(filename, src) {
        // makes it so we can await this function
        return new Promise((resolve, reject) => {
            writeFile(filename, src, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }

    async generateCode(agent_history) {
        // wrapper to prevent overlapping code generation loops
        await this.agent.actions.stop();
        this.generating = true;

        // Initialize result variable
        let res = null;
        
        try {
            // Generate the code
            res = await this.generateCodeLoop(agent_history);
        } catch (error) {
            console.error('Error generating code:', error);
            res = {success: false, message: 'Error generating code', interrupted: false, timedout: false};
        } finally {
            // Always reset generating flag
            this.generating = false;
            
            // Set default result if none was produced
            if (!res) {
                res = {success: false, message: 'Error generating code', interrupted: false, timedout: false};
            }
            
            // Emit idle event if not interrupted
            if (!res.interrupted) {
                this.agent.bot.emit('idle');
            }
        }

        return res.message;
    }

    async generateCodeLoop(agent_history) {
        this.agent.bot.modes.pause('unstuck');

        let messages = agent_history.getHistory();
        messages.push({role: 'system', content: 'Code generation started. Write code in codeblock in your response:'});

        const MAX_ATTEMPTS = 5;
        const MAX_FAILURES = 3;
        
        let code = null;
        let code_return = null;
        let failures = 0;
        const interrupt_return = {success: true, message: 'Code Interrupted.', interrupted: true, timedout: false};
        for (let i = 0; i < MAX_ATTEMPTS; i++) {
            if (this.agent.bot.interrupt_code)
                return interrupt_return;
            let res = await this.agent.prompter.promptCoding(JSON.parse(JSON.stringify(messages)));
            if (this.agent.bot.interrupt_code)
                return interrupt_return;

            // Check if response contains code
            let contains_code = res.indexOf('```') !== -1;
            if (!contains_code) {
                failures++;
                
                if (failures >= MAX_FAILURES) {
                    return { 
                        success: false, 
                        message: 'Action failed, agent would not write code.', 
                        interrupted: false, 
                        timedout: false 
                    };
                }
                messages.push({
                    role: 'system', 
                    content: 'Error: no code provided. Write code in codeblock in your response. ``` // example ```'}
                );
                continue;
            }
            code = res.substring(res.indexOf('```')+3, res.lastIndexOf('```'));

            // Validate skills used in code
            const skillFunctionRegex = /skills\.([\w]+)/g;
            let invalidSkillFound = false;
            let match;

            while ((match = skillFunctionRegex.exec(code)) !== null) {
                const skillName = match[1];
                if (!skills[skillName]) {
                    const resMsg = `Error: Skill function ${skillName} is not defined in skills.js`;
                    agent_history.add('system', resMsg);
                    messages.push({
                        role: 'system',
                        content: resMsg
                    });
                    invalidSkillFound = true;
                    break;
                }
            }

            if (invalidSkillFound) {
                continue;
            }

            // Stage the code
            const result = await this.stageCode(code);
            if (!result.func) {
                const errorMessage = 'Failed to stage code: ' + result.message;
                agent_history.add('system', errorMessage);
                messages.push({
                    role: 'system',
                    content: errorMessage
                });
                continue;
            }
            const executionModuleExports = result.func;
            if (!executionModuleExports) {
                agent_history.add('system', 'Failed to stage code, something is wrong.');
                return {success: false, message: null, interrupted: false, timedout: false};
            }
            let src_lint_copy = result.src_lint_copy;
            const analysisResult = await this.lintCode(src_lint_copy);
            if (analysisResult) {
                const message = 'Error: Code syntax error. Please try again:'+'\n'+analysisResult+'\n';
                messages.push({ role: 'system', content: message });
                continue;
            }

            // run the code
            try {
                code_return = await this.agent.actions.runAction('newAction:' + this.actionLabel, async () => {
                    return await executionModuleExports.main(this.agent.bot);
                }, { timeout: settings.code_timeout_mins });
                if (!code_return) {
                    agent_history.add('system', 'Failed to execute code, no return value.');
                    messages.push({ role: 'system', content: 'Failed to execute code, no return value.' });
                    return { 
                        success: false, 
                        message: 'Failed to execute code.', 
                        interrupted: false, 
                        timedout: false 
                    };
                }
                this.agent.bot.modes.unpause('unstuck');

                if (code_return.interrupted && !code_return.timedout)
                    return { success: false, message: null, interrupted: true, timedout: false };
                console.log("Code generation result:", code_return.success, code_return.message.toString());

                if (code_return.success) {
                    const summary = "Summary of newAction\nAgent wrote this code: \n```" + this.sanitizeCode(code) + "```\nCode Output:\n" + code_return.message.toString();
                    return { success: true, message: summary, interrupted: false, timedout: false };
                }

                messages.push({
                    role: 'assistant',
                    content: res
                });
                messages.push({
                    role: 'system',
                    content: code_return.message + '\nCode failed. Please try again:'
                });
            } catch (error) {
                this.agent.bot.modes.unpause('unstuck');
                messages.push({
                    role: 'assistant',
                    content: res
                });
                messages.push({
                    role: 'system',
                    content: `Execution error: ${error.message}\nCode failed. Please try again:`
                });
            }
        }
        return { 
            success: false, 
            message: 'Code generation attempts exhausted. Please try again.', 
            interrupted: false, 
            timedout: true 
        };
    }
}