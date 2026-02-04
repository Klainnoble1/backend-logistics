-- Add delivery confirmation and rider review to assignments
ALTER TABLE assignments
  ADD COLUMN IF NOT EXISTS delivery_confirmed_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS rating SMALLINT CHECK (rating >= 1 AND rating <= 5),
  ADD COLUMN IF NOT EXISTS review_comment TEXT;
