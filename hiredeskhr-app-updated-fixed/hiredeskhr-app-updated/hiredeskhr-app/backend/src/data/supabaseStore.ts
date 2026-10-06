import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  throw new Error('Supabase environment variables are missing');
}

export const supabase = createClient(url, key);

export async function loadSupabaseState() {
  const { data, error } = await supabase
    .from('hiredesk_state')
    .select('data')
    .eq('id', 'main')
    .single();

  if (error) {
    throw new Error(`Failed to load Supabase state: ${error.message}`);
  }

  return data?.data ?? null;
}

export async function saveSupabaseState(state: unknown) {
  const { error } = await supabase
    .from('hiredesk_state')
    .upsert(
      {
        id: 'main',
        data: state,
        updated_at: new Date().toISOString()
      },
      { onConflict: 'id' }
    );

  if (error) {
    throw new Error(`Failed to save Supabase state: ${error.message}`);
  }
}