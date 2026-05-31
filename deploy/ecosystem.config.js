// Binwak - PM2 config
// Usage: pm2 start ecosystem.config.js

module.exports = {
  apps: [
    {
      name: 'binwak-api',
      cwd: './server',
      script: 'dist/server/src/index.js',
      
      // Environment variables
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      
      // Process management
      instances: 1,              // Single instance because SQLite does not support multi-process writes.
      exec_mode: 'fork',
      
      // Auto restart
      watch: false,
      max_memory_restart: '500M',
      
      // Logs
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: './logs/error.log',
      out_file: './logs/out.log',
      merge_logs: true,
      
      // Crash restart policy
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 5000,
    },
  ],
}
