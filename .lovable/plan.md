

# Fix support-send-message to use new thread schema

## The 3 Bugs

All in `supabase/functions/support-send-message/index.ts`:

1. **Wrong table names** — queries `support_conversations` and `support_messages` instead of `support_threads` and `thread_messages`
2. **Wrong status values** — uses `waiting_agent`, `assigned`, `closed` instead of `open`, `waiting_admin`, `waiting_user`, `resolved`
3. **Wrong column names** — inserts `conversation_id`, `content`, `meta` instead of `thread_id`, `message`, `sender_id` + `source`

## Fix Details

**File**: `supabase/functions/support-send-message/index.ts`

| Line(s) | Current | Fix |
|---------|---------|-----|
| 53 | `let conversationId` | `let threadId` |
| 57-62 | `.from("support_conversations")` | `.from("support_threads")` |
| 77-84 | `.from("support_conversations")` + `.in("status", ["waiting_agent", "assigned"])` | `.from("support_threads")` + `.in("status", ["open", "waiting_admin", "waiting_user"])` |
| 93-100 | `.eq("status", "closed")` | `.eq("status", "resolved")` |
| 105-112 | `.update({ status: "waiting_agent", assigned_agent_id: null, ... })` | `.update({ status: "open", last_message_at: now() })` |
| 118-122 | `.insert({ user_id, status: "waiting_agent", language })` | `.insert({ user_id, status: "waiting_admin" })` (no `language` column in new schema) |
| 137-145 | `.from("support_messages").insert({ conversation_id, sender_type: "user", content, meta })` | `.from("thread_messages").insert({ thread_id, sender_type: "user", sender_id: user.id, message, source: "freeform" })` |
| 155-159 | `.from("support_conversations").update({ last_message_at })` | `.from("support_threads").update({ last_message_at, status: "waiting_admin" })` |
| 166-170 | `.from("support_messages").select("id, sender_type, content, meta, created_at").eq("conversation_id", ...)` | `.from("thread_messages").select("id, sender_type, message, source, created_at").eq("thread_id", ...)` |
| 176 | `status: "waiting_agent"` | `status: "waiting_admin"` |

Also check `submit-support-message/index.ts` — it has the same issues but references `support_conversations` with statuses `bot`, `waiting`, `active`. Same fix pattern needed there.

## Also Fix: `submit-support-message/index.ts`

Same mapping: `support_conversations` → `support_threads`, `support_messages` → `thread_messages`, old statuses → new statuses, old columns → new columns.

## No migration needed
The `support_threads` and `thread_messages` tables already exist with the correct schema. This is purely an edge function code fix.

