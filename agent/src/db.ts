import { Pool, neon } from '@neondatabase/serverless';
import 'dotenv/config';

// Check for DATABASE_URL
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is not set');
}

// Create a Neon DB pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

/**
 * Executes a query using the Neon DB pool.
 * @param text The SQL query string.
 * @param params Optional array of parameters for the query.
 * @returns The query result.
 */
export async function query(text: string, params: any[] = []) {
  const client = await pool.connect();
  try {
    const result = await client.query(text, params);
    return result;
  } finally {
    client.release();
  }
}

/**
 * Creates the `user_profiles` table if it doesn't already exist.
 * This is a simple schema to store profile data as a JSON blob.
 */
export async function setupDatabase() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS user_profiles (
      id SERIAL PRIMARY KEY,
      user_id VARCHAR(255) UNIQUE,
      profile_data JSONB,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `;

  // Function to update `updated_at` timestamp on row change
  const createTriggerFunction = `
    CREATE OR REPLACE FUNCTION update_updated_at_column()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ language 'plpgsql';
  `;

  // Trigger to execute the function
  const createTrigger = `
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'update_user_profiles_updated_at'
      ) THEN
        CREATE TRIGGER update_user_profiles_updated_at
        BEFORE UPDATE ON user_profiles
        FOR EACH ROW
        EXECUTE FUNCTION update_updated_at_column();
      END IF;
    END;
    $$;
  `;

  try {
    console.log('Setting up database schema...');
    await query(createTableQuery);
    await query(createTriggerFunction);
    await query(createTrigger);
    console.log('Database schema setup complete.');
  } catch (error) {
    console.error('Error setting up database schema:', error);
    // It's okay if the table or trigger already exists, but we rethrow for other errors.
    if (!(error instanceof Error && error.message.includes('already exists'))) {
      throw error;
    }
  }
}

// Run setup on module load
setupDatabase().catch(err => {
    console.error("Failed to initialize the database on startup.", err)
});
