-- Migration to remove unused User and Credential tables
-- These tables were placeholders for future authentication
-- Authentication will be handled by Clerk when implemented

-- Drop indexes first
DROP INDEX IF EXISTS "Credential_credentialId_idx";
DROP INDEX IF EXISTS "Credential_userId_idx";
DROP INDEX IF EXISTS "Credential_credentialId_key";
DROP INDEX IF EXISTS "Credential_userId_key";
DROP INDEX IF EXISTS "User_username_key";

-- Drop the Credential table (must come before User due to foreign key)
DROP TABLE IF EXISTS "Credential";

-- Drop the User table
DROP TABLE IF EXISTS "User";