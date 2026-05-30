CREATE OR REPLACE FUNCTION increment_brand_voice_attempts(
  p_business_id uuid
) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE trial_state
  SET brand_voice_inference_attempts = brand_voice_inference_attempts + 1
  WHERE business_id = p_business_id;
$$;

CREATE OR REPLACE FUNCTION increment_posts_generated(
  p_business_id uuid
) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE trial_state
  SET posts_generated_count = posts_generated_count + 1
  WHERE business_id = p_business_id;
$$;
