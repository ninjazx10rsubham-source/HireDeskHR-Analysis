import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('❌ Supabase environment variables missing');
  process.exit(1);
}

const supabase = createClient(url, key);

async function test() {
  const { data, error } = await supabase
    .from('hiredesk_state')
    .select('id')
    .limit(1);

  if (error) {
    console.error('❌ Supabase connection failed:', error.message);
    process.exit(1);
  }

  console.log('✅ Supabase connection successful!');
  console.log('Table hiredesk_state is accessible.');
  console.log('Rows found:', data?.length ?? 0);
}

test();