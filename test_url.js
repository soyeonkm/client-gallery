import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);
async function run() {
  const { data, error } = await supabase.from('images').select('*').order('created_at', { ascending: false }).limit(1);
  if (error) console.error(error);
  else {
    console.log("Latest image:", data[0]);
    if (data[0]) {
      const url = data[0].preview_url;
      console.log("Fetching url:", url);
      const res = await fetch(url, { method: 'HEAD' });
      console.log("Response:", res.status, res.statusText);
    }
  }
}
run();
