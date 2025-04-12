import { writeFile, readFile, mkdirSync } from 'fs';
import settings from '../../settings.js';
import { makeCompartment } from './library/lockdown.js';
import * as skills from './library/skills.js';
import * as world from './library/world.js';
import { Vec3 } from 'vec3';
import {ESLint} from "eslint";
import { logger } from '../utils/logger.js';

export class Coder {
    constructor(agent) {
        this.agent = agent;
        this.file_counter = 0;
        this.fp = '/bots/'+agent.name+'/action-code/';
        this.code_template = '';
        this.code_lint_template = '';

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

    async generateCode(agent_history, actionLabel=null) {
        this.agent.bot.modes.pause('unstuck');
        this.generating = true;
        try {
            // this message history is transient and only maintained in this function
            let messages = agent_history.getHistory(); 
            messages.push({role: 'system', content: 'Code generation started. Write code in codeblock in your response:'});

            const MAX_ATTEMPTS = 5;
            const MAX_NO_CODE = 3;

            let code = null;
            let no_code_failures = 0;
            const interrupt_return = 'Code generation interrupted by another action.';
            for (let i=0; i<MAX_ATTEMPTS; i++) {
                if (this.agent.bot.interrupt_code)
                    return interrupt_return;
                const messages_copy = JSON.parse(JSON.stringify(messages));
                let res = await this.agent.prompter.promptCoding(messages_copy);
                if (this.agent.bot.interrupt_code)
                    return interrupt_return;
                let contains_code = res.indexOf('```') !== -1;
                if (!contains_code) {
                    if (res.indexOf('!newAction') !== -1) {
                        messages.push({
                            role: 'assistant', 
                            content: res.substring(0, res.indexOf('!newAction'))
                        });
                        continue; // using newaction will continue the loop
                    }
                    
                    if (no_code_failures >= MAX_NO_CODE) {
                        logger.warn("Action failed, agent would not write code.");
                        return 'Action failed, agent would not write code.';
                    }
                    messages.push({
                        role: 'system', 
                        content: 'Error: no code provided. Write code in codeblock in your response. ``` // example ```'}
                    );
                    logger.warn("No code block generated. Trying again.");
                    no_code_failures++;
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
                let result = null;
                let executionModule = null;
                try {
                    result = await this._stageCode(code, actionLabel);
                    if (!result) {
                        continue;
                    }
                    executionModule = result.func;
                    const lintResult = await this._lintCode(result.src_lint_copy);
                    if (lintResult) {
                        const message = 'Error: Code lint error:'+'\n'+lintResult+'\nPlease try again.';
                        logger.warn("Linting error:"+'\n'+lintResult+'\n');
                        messages.push({ role: 'system', content: message });
                        continue;
                    }
                    if (!executionModule) {
                        logger.warn("Failed to stage code, something is wrong.");
                        messages.push({ role: 'system', content: 'Failed to stage code, please try again.' });
                        continue;
                    }
                    result = executionModule;
                } catch (e) {
                    logger.error('Error staging code:', e);
                    messages.push({ role: 'system', content: 'Error staging code: ' + e.message });
                    continue;
                }

                try {
                    logger.debug('Executing code...');
                    await executionModule.main(this.agent.bot);

                    const code_output = this.agent.actions.getBotOutputSummary();
                    const summary = "Agent wrote this code: \n```" + this._sanitizeCode(code) + "```\nCode Output:\n" + code_output;
                    return summary;
                } catch (e) {
                    if (this.agent.bot.interrupt_code)
                        return null;
                    
                    logger.warn('Generated code threw error: ' + e.toString());
                    logger.warn('trying again...');

                    const code_output = this.agent.actions.getBotOutputSummary();

                    messages.push({
                        role: 'assistant',
                        content: res
                    });
                    messages.push({
                        role: 'system',
                        content: `Code Output:\n${code_output}\nCODE EXECUTION THREW ERROR: ${e.toString()}\n Please try again:`
                    });
                }
            }
            return `Code generation failed after ${MAX_ATTEMPTS} attempts.`;
        } catch (outerErr) {
            logger.error('Error in generateCode:', outerErr.message);
            return 'Failed to generate code: ' + outerErr.message;
        } finally {
            this.generating = false;
            // this.agent.bot.modes.resume('unstuck');
        }
    }
    
    async  _lintCode(code) {
        let result = '#### CODE ERROR INFO ###\n';
        // Extract everything in the code between the beginning of 'skills./world.' and the '('
        const skillRegex = /(?:skills|world)\.(.*?)\(/g;
        const skills = [];
        let match;
        while ((match = skillRegex.exec(code)) !== null) {
            skills.push(match[1]);
        }
        try {
            const allDocs = await this.agent.prompter.skill_libary.getAllSkillDocs();
            // check function exists
            const missingSkills = skills.filter(skill => !!allDocs[skill]);
            if (missingSkills.length > 0) {
                result += 'These functions do not exist.\n';
                result += '### FUNCTIONS NOT FOUND ###\n';
                result += missingSkills.join('\n');
                logger.debug('Result: ', result);
                return result;
            }
        } catch (skillError) {
            logger.error('Error checking skill documentation:', skillError);
            // Continue with linting even if skill check fails
        } finally {
            this.generating = false;
        }

        const directApiRegex = /bot\.(placeBlock|dig|equip|activateBlock|pathfinder|chat|wait)/g;
        const directApiCalls = [];
        let dApiMatch;
        while ((dApiMatch = directApiRegex.exec(code)) !== null) {
            directApiCalls.push(dApiMatch[1]);
        }

        if (directApiCalls.length > 0) {
            result += 'Using these direct Mineflayer APIs is not allowed. Please use the skills library instead:\n';
            directApiCalls.forEach(apiCall => {
                result += `- Replace bot.${apiCall}() with skills.${apiCall}() or another appropriate skills function\n`;
            });
            this.generating = false;
            return result;
        }
        try {
            const eslint = new ESLint();
            const results = await eslint.lintText(code);
            const codeLines = code.split('\n');
            const exceptions = results.map(r => r.messages).flat();

            if (exceptions.length > 0) {
                exceptions.forEach((exc, index) => {
                    if (exc.line && exc.column ) {
                        const errorLine = codeLines[exc.line - 1]?.trim() || 'Unable to retrieve error line content';
                        result += `#ERROR ${index + 1}\n`;
                        result += `Message: ${exc.message}\n`;
                        result += `Location: Line ${exc.line}, Column ${exc.column}\n`;
                        result += `Related Code Line: ${errorLine}\n`;
                    }
                });
                result += 'The code contains exceptions and cannot continue execution.';
            } else {
                return null;//no error
            }
        } catch (lintError) {
            logger.error('ESLint execution error:', lintError);
            return `ESLint error: ${lintError.message || 'Unknown linting error occurred'}`;
        }
    }

    // Fixed instrumentation that carefully handles for loops to avoid syntax errors
    fixedInstrumentCode(code, actionLabel=null) {
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

        const clearDesign = `bot.blockList = [];
            bot.scaffoldBlocks = [];`;
        
        // Now add interrupt checks after each semicolon in the rest of the code
        processedCode = processedCode.replace(/;/g, '; if(check_interrupts()) { return {success: false, message: "Code interrupted", interrupted: true, timedout: false}; }\n');
        
        // Restore the for loops
        for (const loop of forLoops) {
            processedCode = processedCode.replace(loop.placeholder, loop.original);
        }

        const actionLabelText = `const actionLabel = "${actionLabel}";`;
        logger.debug('coder actionLabel: ', actionLabel);

        // add check interrupts function
        // add small delay for bots trying to spam between various function calls
        const checkIntFunc = `function check_interrupts() {
            if (!bot || !bot.interrupt_code) { return false; }
            skills.wait(bot, 50);
            log(bot, "Interrupt found, code interrupted");
            ${clearDesign}
            return true;
        }`;
        const returnFunc = `return {success: true, message: "Code completed successfully", interrupted: false, timedout: false};`;
        processedCode = clearDesign + '\n' + actionLabelText + '\n' + checkIntFunc + '\n' + processedCode + '\n' + returnFunc;
        
        return processedCode;
    }

    // Helper function to protect for loops from being broken by semicolon replacement
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

    // write custom code to file and import it
    // write custom code to file and prepare for evaluation
    async _stageCode(code, actionLabel=null) {
        code = this._sanitizeCode(code);
        let src = '';
        code = code.replaceAll('console.log(', 'log(bot,');
        code = code.replaceAll('log("', 'log(bot,"');

        // Process the code with fixed instrumentation
        code = this.fixedInstrumentCode(code, actionLabel);

        logger.debug(`Generated code: """${code}"""`);

        // this may cause problems in callback functions
        // code = code.replaceAll(';\n', '; if(bot.interrupt_code) {log(bot, "Code interrupted.");return;}\n');
        for (let line of code.split('\n')) {
            src += `    ${line}\n`;
        }
        let src_lint_copy = this.code_lint_template.replace('/* CODE HERE */', src);
        src = this.code_template.replace('/* CODE HERE */', src);

        let filename = this.file_counter + '.js';
        this.agent.bot.codeFilePath = filename;
        this.file_counter++;
        
        let write_result = await this._writeFilePromise('.' + this.fp + filename, src);
        // This is where we determine the environment the agent's code should be exposed to.
        // It will only have access to these things, (in addition to basic javascript objects like Array, Object, etc.)
        // Note that the code may be able to modify the exposed objects.
        try {
            const compartment = makeCompartment({
                skills,
                log: skills.log,
                world,
                Vec3,
            });
            const mainFn = compartment.evaluate(src);
            
            if (write_result) {
                logger.error('Error writing code execution file: ' + result);
                return null;
            }
            return { func:{main: mainFn}, src_lint_copy: src_lint_copy };
        } catch (compartmentError) {
            logger.error('Compartment execution error:', compartmentError);

            // let the bot know what it messed up if there was some error caught
            skills.log(this.agent.bot, 'Compartment execution error:', compartmentError.toString().split('\n')[0]);
            
            // Extract a clean error message
            let errMessage = compartmentError.message || String(compartmentError);
            if (errMessage) {
                // Take substring until a newline for cleaner output
                errMessage = errMessage.split('\n')[0];
            }
            return null;
        }
    }

    _sanitizeCode(code) {
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

    _writeFilePromise(filename, src) {
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
}