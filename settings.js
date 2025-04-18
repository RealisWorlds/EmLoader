const settings = {
    "minecraft_version": "1.21.4", // supports up to 1.21.1
    "host": "map.realismc.com",// or "localhost", "map.realismc.com" "127.0.0.1", //
    "port": 9683,//25565, //
    "auth": "offline", // or "microsoft"

    // the mindserver manages all agents and hosts the UI
    "host_mindserver": true, // if true, the mindserver will be hosted on this machine. otherwise, specify a public IP address
    "mindserver_host": "localhost",
    "mindserver_port": 8080,
    
    // the base profile is shared by all bots for default prompts/examples/modes
    "base_profile": "./profiles/defaults/survival.json", // also see creative.json, god_mode.json
    "profiles": [
    	"./profiles/Clyyde.json",
        //"./andy.json",
        // "./profiles/gpt.json",
        // "./profiles/claude.json",
        // "./profiles/gemini.json",
        // "./profiles/llama.json",
        // "./profiles/qwen.json",
        // "./profiles/grok.json",
        // "./profiles/mistral.json",
        // "./profiles/deepseek.json",

        // using more than 1 profile requires you to /msg each bot indivually
        // individual profiles override values from the base profile
    ],
    "logLevel": 4, // ERROR=0, WARN=1, INFO=2, DEBUG=3, TRACE=4
    "load_memory": true, // load memory from previous session
    "init_message": "Respond with hello world and your name", // sends to all on spawn
    "only_chat_with": [], // users that the bots listen to and send general messages to. if empty it will chat publicly
    "speak": false, // allows all bots to speak through system text-to-speech. works on windows, mac, on linux you need to `apt install espeak`
    "language": "en", // translate to/from this language. Supports these language names: https://cloud.google.com/translate/docs/languages
    
    // WebSocket streaming settings
    "show_bot_views": false, // show bot's view in browser at localhost:3000, 3001...
    "stream_bot_views": false, // enable streaming bot views over WebSocket
    "viewer_stream_port": 8089, // WebSocket server URL to connect to
    "stream_quality": 0.7, // JPEG quality for streamed frames (0-1)

    "allow_insecure_coding": true, // allows newAction command and model can write/run code on your computer. enable at own risk
    "allow_vision": false, // allows vision model to interpret screenshots as inputs
    "blocked_actions" : [], // commands to disable and remove from docs. Ex: ["!setMode"]
    "code_timeout_mins": -1, // minutes code is allowed to run. -1 for no timeout
    "relevant_docs_count": 5, // number of relevant code function docs to select for prompting. -1 for all

    "execution_timeout": 60, // After execution_timeout seconds and no interrupt, code kills itself.
    "max_messages":15, // max number of messages to keep in context
    "num_examples": 2, // number of examples to give to the model
    "max_commands": 1, // max number of commands that can be used in consecutive responses. -1 for no limit
    "max_parallel_gen": 2, // max number of responses to generate in parallel; must be >1 or lockup can occur
    "max_response_length": 180, // max number of characters in a chat message
    "verbose_commands": false, // show full command syntax
    "narrate_behavior": false, // chat simple automatic actions ('Picking up item!')
    "chat_bot_messages": false, // publicly chat messages to other bots
}

// these environment variables override certain settings
if (process.env.MINECRAFT_PORT) {
    settings.port = process.env.MINECRAFT_PORT;
}
if (process.env.MINDSERVER_PORT) {
    settings.mindserver_port = process.env.MINDSERVER_PORT;
}
if (process.env.PROFILES && JSON.parse(process.env.PROFILES).length > 0) {
    settings.profiles = JSON.parse(process.env.PROFILES);
}
export default settings;
