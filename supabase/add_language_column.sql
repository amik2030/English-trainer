-- SpeakEasy AI - Add language column to conversations table
-- Run this in Supabase SQL Editor (idempotent - safe to run multiple times)

-- Add language column if it doesn't exist yet
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'conversations' AND column_name = 'language'
    ) THEN
        ALTER TABLE public.conversations
        ADD COLUMN language TEXT DEFAULT 'English';
    END IF;
END $$;

-- Backfill existing rows to 'English' (they were all English conversations)
UPDATE public.conversations
SET language = 'English'
WHERE language IS NULL OR language = '';
