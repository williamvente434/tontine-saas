const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'tontine',
  password: process.env.DB_PASSWORD || 'postgres',
  port: Number(process.env.DB_PORT) || 5432,
});

pool.on('connect', () => {
  console.log('Connected to PostgreSQL');
});

module.exports = { pool };
