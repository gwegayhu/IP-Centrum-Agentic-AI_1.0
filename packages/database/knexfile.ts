import type { Knex } from 'knex';
import 'dotenv/config';

const config: Record<string, Knex.Config> = {
  development: {
    client: 'pg',
    connection: process.env.DATABASE_URL || 'postgresql://ipcentrum:password@localhost:5432/ipcentrum_db',
    migrations: { directory: './migrations', extension: 'ts' },
    seeds: { directory: './seeds', extension: 'ts' },
  },
  test: {
    client: 'pg',
    connection: process.env.DATABASE_URL || 'postgresql://ipcentrum:test_password@localhost:5432/ipcentrum_test',
    migrations: { directory: './migrations', extension: 'ts' },
    seeds: { directory: './seeds', extension: 'ts' },
  },
  production: {
    client: 'pg',
    connection: process.env.DATABASE_URL,
    pool: { min: 2, max: 20 },
    migrations: { directory: './migrations', extension: 'js' },
  },
};

module.exports = config[process.env.NODE_ENV || 'development'];
