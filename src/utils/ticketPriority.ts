// Auto-detect ticket priority based on keywords in subject and description

const HIGH_PRIORITY_KEYWORDS = [
  'urgent',
  'critical',
  'broken',
  'not working',
  'payment issue',
  'payment failed',
  'cant access',
  'error',
  'immediately',
  'asap',
  'emergency',
  'fraud',
  'hacked',
  'security',
  'account locked',
  'money',
  'refund',
];

const MEDIUM_PRIORITY_KEYWORDS = [
  'problem',
  'issue',
  'question',
  'help',
  'support',
  'slow',
  'delayed',
  'missing',
];

export function detectTicketPriority(subject: string, description: string): 'low' | 'medium' | 'high' | 'urgent' {
  const combined = `${subject} ${description}`.toLowerCase();
  
  // Check for high priority keywords
  for (const keyword of HIGH_PRIORITY_KEYWORDS) {
    if (combined.includes(keyword)) {
      return 'high';
    }
  }
  
  // Check for medium priority keywords
  for (const keyword of MEDIUM_PRIORITY_KEYWORDS) {
    if (combined.includes(keyword)) {
      return 'medium';
    }
  }
  
  // Default to low priority
  return 'low';
}
