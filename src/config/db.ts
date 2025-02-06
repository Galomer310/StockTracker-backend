import { Pool } from "pg";                     // Import the Pool class from the pg (PostgreSQL) library
import dotenv from "dotenv";                   // Import dotenv to load environment variables

dotenv.config();                               // Load environment variables from a .env file

// Create a new connection pool using the DATABASE_URL environment variable
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,  // Use the connection string from the environment
  ssl: { rejectUnauthorized: false }           // Use SSL but do not reject unauthorized certificates (useful for Heroku)
});

export default pool;                           // Export the pool instance for use in other parts of the backend
