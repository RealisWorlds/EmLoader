module.exports = {
    apps: [
      {
        name: 'EmFramework',
        script: process.platform === 'win32' ? './main.js' : 'main.js',
        interpreter: 'node',
        interpreter_args: '--experimental-modules',
        watch: true,
        ignore_watch: ["node_modules", "logs", "bots", "profiles", "models"],
        max_memory_restart: '1G',
        exec_mode: "fork",
        env: {
          NODE_ENV: "production",
          UPDATE_SCRIPT: "node update-from-github.js"
        },
        autorestart: true,
        restart_delay: 1000,
        error_file: 'logs/error.log',
        out_file: 'logs/out.log',
        merge_logs: true,
        update: {
          enabled: true,
          source: 'github',
          repository: 'RealisWorlds/EmLoader',
          branch: 'master',
          interval: 86400000 // Check for updates every 24 hours
        }
      }
    ]
  };
  // REMOVE the line below (ESM export):
  // export default config;
  