// Polls Telegram bot getUpdates and saves forwarded photos as draft products.
// Public access — protected via shared secret or service-role only.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

const GATEWAY_URL = 'https://connector-gateway.lovable.dev/telegram';
const MAX_RUNTIME_MS = 50_000;
const MIN_REMAINING_MS = 6_000;

type TgPhoto = { file_id: string; width: number; height: number; file_size?: number };
type TgMessage = {
  message_id: number;
  date: number;
  chat: { id: number; type: string; title?: string };
  from?: { id: number; username?: string; first_name?: string };
  forward_origin?: {
    type: string;
    chat?: { id: number; title?: string; username?: string };
    message_id?: number;
  };
  // legacy fields (some clients still send these)
  forward_from_chat?: { id: number; title?: string; username?: string };
  forward_from_message_id?: number;
  caption?: string;
  text?: string;
  photo?: TgPhoto[];
  media_group_id?: string;
};
type TgUpdate = { update_id: number; message?: TgMessage; channel_post?: TgMessage };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const startTime = Date.now();

  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  const TELEGRAM_API_KEY = Deno.env.get('TELEGRAM_API_KEY');
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!LOVABLE_API_KEY || !TELEGRAM_API_KEY || !SUPABASE_URL || !SERVICE_KEY) {
    return json({ error: 'Missing required environment variables' }, 500);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // Manual invocations (admin "Check now" button) should return immediately
  // instead of long-polling for up to 50s waiting for new messages.
  let manual = false;
  try {
    if (req.method === 'POST') {
      const body = await req.clone().json().catch(() => ({}));
      manual = body?.manual === true;
    }
    const url = new URL(req.url);
    if (url.searchParams.get('manual') === '1') manual = true;
  } catch { /* ignore */ }

  // Read polling offset
  const { data: state, error: stateErr } = await supabase
    .from('telegram_import_state')
    .select('update_offset')
    .eq('id', 1)
    .single();
  if (stateErr) return json({ error: stateErr.message }, 500);

  let currentOffset: number = state.update_offset;
  let totalProcessed = 0;
  const errors: string[] = [];

  let iterations = 0;
  while (true) {
    // Manual mode: do at most one immediate-return poll, no long-polling.
    if (manual && iterations >= 1) break;
    const remaining = MAX_RUNTIME_MS - (Date.now() - startTime);
    if (remaining < MIN_REMAINING_MS) break;
    const timeout = manual ? 0 : Math.min(45, Math.floor(remaining / 1000) - 5);
    if (!manual && timeout < 1) break;
    iterations += 1;

    let updates: TgUpdate[] = [];
    try {
      const r = await fetch(`${GATEWAY_URL}/getUpdates`, {
        method: 'POST',
        headers: tgHeaders(LOVABLE_API_KEY, TELEGRAM_API_KEY),
        body: JSON.stringify({
          offset: currentOffset,
          timeout,
          allowed_updates: ['message', 'channel_post'],
        }),
      });
      const data = await r.json();
      if (!r.ok) {
        errors.push(`getUpdates failed [${r.status}]: ${JSON.stringify(data)}`);
        break;
      }
      updates = data.result ?? [];
    } catch (e) {
      errors.push(`getUpdates exception: ${e instanceof Error ? e.message : String(e)}`);
      break;
    }

    if (updates.length === 0) {
      if (manual) break;
      continue;
    }

    for (const upd of updates) {
      const msg = upd.message ?? upd.channel_post;
      if (!msg) continue;

      try {
        // Only handle messages with photos (a forwarded post with media)
        if (!msg.photo || msg.photo.length === 0) continue;

        // Pick the highest-resolution photo
        const best = msg.photo.reduce((a, b) => (a.width * a.height >= b.width * b.height ? a : b));

        // Get file path
        const fileResp = await fetch(`${GATEWAY_URL}/getFile`, {
          method: 'POST',
          headers: tgHeaders(LOVABLE_API_KEY, TELEGRAM_API_KEY),
          body: JSON.stringify({ file_id: best.file_id }),
        });
        const fileData = await fileResp.json();
        if (!fileResp.ok || !fileData?.result?.file_path) {
          errors.push(`getFile failed for msg ${msg.message_id}: ${JSON.stringify(fileData)}`);
          continue;
        }
        const filePath: string = fileData.result.file_path;

        // Download file via gateway
        const dlResp = await fetch(`${GATEWAY_URL}/file/${filePath}`, {
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            'X-Connection-Api-Key': TELEGRAM_API_KEY,
          },
        });
        if (!dlResp.ok) {
          errors.push(`file download failed for msg ${msg.message_id}: HTTP ${dlResp.status}`);
          continue;
        }
        const bytes = new Uint8Array(await dlResp.arrayBuffer());
        const ext = (filePath.split('.').pop() || 'jpg').toLowerCase().slice(0, 4);
        const storagePath = `telegram-import/${msg.chat.id}-${msg.message_id}-${Date.now()}.${ext}`;

        const { error: upErr } = await supabase.storage
          .from('product-images')
          .upload(storagePath, bytes, {
            contentType: ext === 'png' ? 'image/png' : 'image/jpeg',
            upsert: true,
          });
        if (upErr) {
          errors.push(`storage upload failed for msg ${msg.message_id}: ${upErr.message}`);
          continue;
        }

        const { data: pub } = supabase.storage.from('product-images').getPublicUrl(storagePath);
        const publicUrl = pub.publicUrl;

        const fwdChat = msg.forward_origin?.chat ?? msg.forward_from_chat ?? null;
        const fwdMsgId = msg.forward_origin?.message_id ?? msg.forward_from_message_id ?? null;

        const { error: insErr } = await supabase.from('telegram_import_drafts').insert({
          telegram_message_id: msg.message_id,
          telegram_chat_id: msg.chat.id,
          forwarded_from_chat_title: fwdChat?.title ?? null,
          forwarded_from_chat_username: fwdChat?.username ?? null,
          forwarded_from_message_id: fwdMsgId,
          forwarded_by_user_id: msg.from?.id ?? null,
          forwarded_by_username: msg.from?.username ?? null,
          caption: msg.caption ?? msg.text ?? null,
          image_url: publicUrl,
          image_storage_path: storagePath,
          suggested_title: (msg.caption ?? '').split('\n')[0]?.slice(0, 200) || null,
        });
        if (insErr && !insErr.message.includes('duplicate')) {
          errors.push(`insert failed for msg ${msg.message_id}: ${insErr.message}`);
          continue;
        }

        totalProcessed += 1;
      } catch (e) {
        errors.push(`processing error msg ${msg.message_id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // Advance offset AFTER processing
    const newOffset = Math.max(...updates.map((u) => u.update_id)) + 1;
    const { error: offErr } = await supabase
      .from('telegram_import_state')
      .update({ update_offset: newOffset, last_polled_at: new Date().toISOString(), last_error: errors.slice(-3).join(' | ') || null })
      .eq('id', 1);
    if (offErr) {
      errors.push(`offset update failed: ${offErr.message}`);
      break;
    }
    currentOffset = newOffset;
  }

  return json({ ok: true, processed: totalProcessed, finalOffset: currentOffset, errors }, 200);
});

function tgHeaders(lovKey: string, tgKey: string) {
  return {
    Authorization: `Bearer ${lovKey}`,
    'X-Connection-Api-Key': tgKey,
    'Content-Type': 'application/json',
  };
}

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
