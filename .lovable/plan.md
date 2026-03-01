

# Fix Live Chat and Chat Routing

## Problems Identified

### 1. Chat Routing shows only 1 admin
The dropdown queries `user_roles` for admins, then fetches their `profiles`. But many admin profiles have a `NULL` email field (the `email` column in profiles isn't always synced). So admins without an email in their profile don't show up meaningfully. The fix: also look up emails from `auth.users` via a fallback, and ensure the dropdown shows all admins with their name or email.

### 2. Chat Routing is disconnected from Live Chat
The Chat Routing page lets you configure a round-robin queue, but **the Support Inbox completely ignores it**. Conversations just sit as "Unclaimed" until someone manually claims them. The routing config table (`chat_routing_config`) is never consulted when a new conversation arrives.

**Fix**: When a conversation enters `waiting_agent` status, auto-assign it to the next available agent from the routing config. Show a "Reassign" button for super admins so they can move conversations between agents.

### 3. Super admin can't assign conversations or restrict access
Currently any admin with `can_view_tickets` sees ALL conversations. There's no way to assign a specific conversation to a specific person, or restrict which agents see which chats.

**Fix**: 
- Add a "Reassign" dropdown in the chat header (super admin only) to reassign a conversation to any configured agent
- Filter the conversation list so non-super-admin agents only see conversations assigned to them (or unclaimed ones)
- Auto-assign new conversations using the round-robin config

## Implementation Plan

### 1. Fix Chat Routing admin dropdown to show ALL admins
- In `ChatRouting.tsx`, update the profile fetch to use `full_name` or `name` as primary display, falling back to `email`, then user ID prefix
- Run `sync_profile_emails` on admin profiles that are missing emails (the function already exists)
- Show admin name + role in the dropdown for clarity

### 2. Connect Chat Routing to Support Inbox (auto-assign)
- Create a helper function `getNextAvailableAgent()` that reads `chat_routing_config` and returns the next agent (round-robin by lowest `chats_assigned_count` among available agents)
- In `SupportInbox.tsx`, when a conversation status changes to `waiting_agent`, auto-assign it to the next agent and increment their count
- Add a realtime listener so the assignment happens immediately

### 3. Add "Reassign" capability for super admins
- In the chat header of `SupportInbox.tsx`, add a "Reassign" dropdown (visible only to super admins)
- The dropdown lists all agents from `chat_routing_config`
- Selecting an agent reassigns the conversation and sends a system message "Conversation reassigned to [Agent Name]"

### 4. Filter conversations by agent for non-super-admins
- Non-super-admin agents with `can_view_tickets` only see:
  - Conversations assigned to them
  - Unclaimed (`waiting_agent`) conversations
- Super admins continue to see everything

### 5. Improve Chat Routing UX clarity
- Add a clear explanation card: "When a customer starts a live chat and requests a human agent, the system automatically assigns it to the next available agent below"
- Show each agent's name, email, role, and current chat count
- Add a "Sync Emails" button to fix missing email displays

## Files to Edit
- `src/pages/admin/ChatRouting.tsx` -- Fix admin dropdown display, improve UX
- `src/pages/admin/SupportInbox.tsx` -- Add auto-assign, reassign dropdown, agent-based filtering

## Files to Create
None -- all changes fit within existing files.

## What Changes for Users

- **You (super admin)**: See all conversations. Can reassign any conversation to any agent with one click. Chat Routing now actually controls who gets new chats.
- **Limited admins**: Only see their own assigned conversations and unclaimed ones. Can claim unclaimed chats.
- **Customers**: No visible change -- they just get connected to an agent faster (auto-assignment instead of waiting for someone to notice).

