// 市区町村バトル（賭けありの部屋）の Edge Function。進行は logic.mjs、ルールは engine.mjs（battle/index.html からの自動生成）
// 出し方：Management API の functions/deploy（verify_jwt は false。ログインは bt_ticket のチケットで確かめる）
import postgres from 'npm:postgres@3.4.4';
import DATA from './data.json' with { type: 'json' };
import { init, handle, ENGINE } from './logic.mjs';

init(DATA);
const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, { prepare: false, max: 1, idle_timeout: 20, connect_timeout: 10, onnotice: () => {} });
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-region',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (code: number, obj: unknown) => new Response(JSON.stringify(obj), { status: code, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(200, { ok: true, engine: ENGINE });
  let body: unknown;
  try { body = await req.json(); } catch (_e) { return json(400, { error: '送るものが正しくありません' }); }
  try {
    return json(200, await handle(sql, body));
  } catch (e) {
    const err = e as { user?: boolean; message?: string };
    if (!err.user) console.error(e);
    return json(err.user || /^P0001/.test(String((e as { code?: string }).code || '')) ? 400 : 500, { error: err.message || String(e) });
  }
});
