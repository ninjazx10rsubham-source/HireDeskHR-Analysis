import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { saveSupabaseState } from './data/supabaseStore';

async function test() {
  const dbPath = path.resolve(__dirname, 'data', 'database.json');

  const raw = fs.readFileSync(dbPath, 'utf-8');
  const data = JSON.parse(raw);

  await saveSupabaseState(data);

  console.log('✅ Test save to Supabase successful!');
}

test().catch((error) => {
  console.error('❌ Test save failed:', error.message);
  process.exit(1);
});