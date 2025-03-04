export default 
{
    "minecraft_version": "1.21.4", // supports up to 1.21.1
    "host": "localhost",//"map.realismc.com", // or "localhost", "your.ip.address.here"
    "port": process.env.MINECRAFT_PORT || 25565,
    "auth": "offline", // or "microsoft"

    // the mindserver manages all agents and hosts the UI
    "host_mindserver": true, // if true, the mindserver will be hosted on this machine. otherwise, specify a public IP address
    "mindserver_host": "localhost",
    "mindserver_port": process.env.MINDSERVER_PORT || 8080,
    
    // the base profile is shared by all bots for default prompts/examples/modes
    "base_profile": "./profiles/defaults/survival.json", // also see creative.json, god_mode.json
    "profiles": ((process.env.PROFILES) && JSON.parse(process.env.PROFILES)) || [
        "./profiles/BobVilaAI.json",
        // Add more profiles as needed
        // using more than 1 profile requires you to /msg each bot indivually
        // individual profiles override values from the base profile
    ],
    "load_memory": true, // load memory from previous session
    "init_message": "Respond with hello world and your name", // sends to all on spawn
    "only_chat_with": [], // users that the bots listen to and send general messages to. if empty it will chat publicly
    
    "language": "en", // translate to/from this language. Supports these language names: https://cloud.google.com/translate/docs/languages
    "show_bot_views": false, // show bot's view in browser at localhost:3000, 3001...

    "allow_insecure_coding": true, // allows newAction command and model can write/run code on your computer. enable at own risk
    "code_timeout_mins": -1, // minutes code is allowed to run. -1 for no timeout
    "relevant_docs_count": 5, // Parameter: -1 = all, 0 = no references, 5 = five references. If exceeding the maximum, all reference documents are returned.

    "max_messages": 15, // max number of messages to keep in context
    "num_examples": 2, // number of examples to give to the model
    "max_commands": -1, // max number of commands that can be used in consecutive responses. -1 for no limit
    "verbose_commands": true, // show full command syntax
    "narrate_behavior": false, // chat simple automatic actions ('Picking up item!')
    "chat_bot_messages": false, // publicly chat messages to other bots
}
