-- Restora POS — PostgreSQL init script
-- Run automatically on first container start

-- Create staging DB alongside dev
CREATE DATABASE restora_staging;

-- Extensions
\c restora_dev;
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

\c restora_staging;
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
