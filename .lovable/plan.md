
# Plan: Fix False Positive Content Blocking for MacBook/Chromebook Products

## Problem Summary

When searching for "macbook pro" (or any product with "book" in its name), all results are incorrectly filtered out because the content blocker matches "book" within the product name/URL.

**Evidence from logs:**
- `amazonReturned: 10` but `items: []` in API response  
- `[SEARCH] removed=9 remaining=0 reasons={"keyword_url":9}`

## Root Cause

In `supabase/functions/_shared/contentBlocker.ts`, the URL keyword check at **lines 187-191** uses a simple `includes()` without word boundaries:

```typescript
// Line 187-191 (BUG)
for (const keyword of BLOCKED_KEYWORDS) {
  if (urlLower.includes(keyword.replace(/\s+/g, ""))) {  // ← No word boundary!
    return { isDisallowed: true, reason: "keyword_url", matchedPattern: keyword };
  }
}
```

This causes "book" to match within "macbook", blocking legitimate products like:
- MacBook Pro
- MacBook Air  
- Chromebook
- Facebook Portal
- Notebook laptops (title contains "notebook")

## Solution

Add product name exceptions to the URL keyword check that prevent false positives for legitimate electronics brands. The fix ensures "book" only matches when it's a standalone word or part of actual book-related terms (e.g., "ebook", "audiobook").

## Technical Changes

### File: `supabase/functions/_shared/contentBlocker.ts`

**Change 1: Add allowlist of product terms containing blocked keywords (new constant, ~line 61)**

```typescript
// ALLOWLIST: Products containing blocked keywords but are NOT blocked content
// These override keyword matches when found in title/URL
const ALLOWLIST_PATTERNS = [
  "macbook",
  "chromebook", 
  "notebook",      // Laptop computers
  "facebook",      // Facebook products (Portal, etc.)
  "playbook",      // BlackBerry PlayBook, business software
  "scrapbook",     // Physical scrapbooks (craft supplies)
  "cookbook",      // Physical cookbooks are OK (not ebooks)
  "yearbook",      // Physical yearbooks
  "logbook",       // Stationery items
  "guestbook",     // Physical guestbooks
  "checkbook",     // Financial accessories
];
```

**Change 2: Update URL keyword check to skip allowlisted terms (~lines 186-191)**

Before:
```typescript
for (const keyword of BLOCKED_KEYWORDS) {
  if (urlLower.includes(keyword.replace(/\s+/g, ""))) {
    return { isDisallowed: true, reason: "keyword_url", matchedPattern: keyword };
  }
}
```

After:
```typescript
for (const keyword of BLOCKED_KEYWORDS) {
  const keywordNormalized = keyword.replace(/\s+/g, "");
  if (urlLower.includes(keywordNormalized)) {
    // Check if this match is part of an allowlisted product term
    const isAllowlisted = ALLOWLIST_PATTERNS.some(pattern => 
      urlLower.includes(pattern)
    );
    if (!isAllowlisted) {
      return { isDisallowed: true, reason: "keyword_url", matchedPattern: keyword };
    }
  }
}
```

**Change 3: Update title keyword check with same allowlist logic (~lines 169-184)**

Before:
```typescript
for (const keyword of BLOCKED_KEYWORDS) {
  if (keyword.length <= 5) {
    const regex = new RegExp(`\\b${escapeRegex(keyword)}\\b`, "i");
    if (regex.test(titleLower)) {
      return { isDisallowed: true, reason: "keyword_title", matchedPattern: keyword };
    }
  } else {
    if (titleLower.includes(keyword)) {
      return { isDisallowed: true, reason: "keyword_title", matchedPattern: keyword };
    }
  }
}
```

After:
```typescript
for (const keyword of BLOCKED_KEYWORDS) {
  let matches = false;
  
  if (keyword.length <= 5) {
    const regex = new RegExp(`\\b${escapeRegex(keyword)}\\b`, "i");
    matches = regex.test(titleLower);
  } else {
    matches = titleLower.includes(keyword);
  }
  
  if (matches) {
    // Check if this match is part of an allowlisted product term
    const isAllowlisted = ALLOWLIST_PATTERNS.some(pattern => 
      titleLower.includes(pattern)
    );
    if (!isAllowlisted) {
      return { isDisallowed: true, reason: "keyword_title", matchedPattern: keyword };
    }
  }
}
```

## Files to Modify

| File | Change |
|------|--------|
| `supabase/functions/_shared/contentBlocker.ts` | Add ALLOWLIST_PATTERNS constant and update title/URL checks |

## Expected Results After Fix

| Search Query | Before | After |
|--------------|--------|-------|
| "macbook pro" | 0 items (all filtered) | 10+ items |
| "mackoook pro" (typo) | 0 items | 10+ items |
| "chromebook" | 0 items | 10+ items |
| "notebook laptop" | 0 items | 10+ items |
| "kindle ebook" | 0 items (correct) | 0 items (correct) |
| "audiobook" | 0 items (correct) | 0 items (correct) |

## Testing Steps

After deployment, verify:
1. Search "macbook pro" returns Apple MacBook products
2. Search "chromebook" returns laptop results  
3. Search "notebook" returns laptop results
4. Search "kindle" still returns 0 results (blocked correctly)
5. Search "ebook reader" still returns 0 results (blocked correctly)

## Alternative Considered

**Regex word boundary for all URL checks**: This would require significant refactoring and might break legitimate blocks like `/books` path. The allowlist approach is safer and more targeted.
