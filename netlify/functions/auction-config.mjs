// Serves the auction's config.js from Netlify settings, so no keys live in the code.
import { env } from './_lib.mjs';
export default async () => new Response(
  `window.AUCTION_CONFIG=${JSON.stringify({ supabaseUrl: env('SUPABASE_URL'), supabaseAnonKey: env('SUPABASE_PUBLISHABLE_KEY') })};`,
  { headers: { 'content-type': 'application/javascript', 'cache-control': 'no-store' } });
