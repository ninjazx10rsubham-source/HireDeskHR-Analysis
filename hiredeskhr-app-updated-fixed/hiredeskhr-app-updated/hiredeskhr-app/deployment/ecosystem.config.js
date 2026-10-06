module.exports = {
  apps: [
    {
      name: 'talentflow-backend',
      script: './dist/index.js',
      cwd: '/var/www/talentflow-ats/backend',
      instances: 'max',
      exec_mode: 'cluster',
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 5001
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 5001
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: '/var/log/talentflow/backend-error.log',
      out_file: '/var/log/talentflow/backend-out.log',
      merge_logs: true
    }
  ]
};
