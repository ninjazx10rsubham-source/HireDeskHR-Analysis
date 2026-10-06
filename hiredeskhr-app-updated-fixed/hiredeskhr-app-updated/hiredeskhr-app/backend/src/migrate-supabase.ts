import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('❌ Supabase environment variables missing');
  process.exit(1);
}

const supabase = createClient(url, key);

const dbPath = path.resolve(__dirname, 'data', 'database.json');

async function migrate() {
  console.log('📂 Reading database.json...');

  const raw = fs.readFileSync(dbPath, 'utf-8');
  const data = JSON.parse(raw);

  console.log('✅ database.json loaded');

  const { data: existing, error: checkError } = await supabase
    .from('hiredesk_state')
    .select('id')
    .eq('id', 'main');

  if (checkError) {
    console.error('❌ Supabase check failed:', checkError.message);
    process.exit(1);
  }

  if (existing && existing.length > 0) {
    console.log('⚠️ Supabase already contains a "main" state.');
    console.log('Migration stopped to prevent accidental overwrite.');
    process.exit(0);
  }

  const { error } = await supabase
    .from('hiredesk_state')
    .insert({
      id: 'main',
      data
    });

  if (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  }

  console.log('🎉 Migration successful!');
  console.log('✅ database.json data is now stored in Supabase.');
  console.log('✅ Original database.json was NOT changed.');
}

migrate();