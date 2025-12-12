// Auto-detect ticket priority based on keywords and customer context

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

// Customer context thresholds for VIP treatment
const VIP_ORDER_COUNT_THRESHOLD = 5;
const VIP_TOTAL_SPENT_THRESHOLD = 500; // USD

export interface CustomerContext {
  orderCount?: number;
  totalSpent?: number;
  isVip?: boolean;
}

/**
 * Detect ticket priority based on content keywords and optional customer context.
 * High-value customers (VIP) get priority bumped automatically.
 */
export function detectTicketPriority(
  subject: string, 
  description: string,
  customerContext?: CustomerContext
): 'low' | 'medium' | 'high' | 'urgent' {
  const combined = `${subject} ${description}`.toLowerCase();
  
  // Determine base priority from keywords
  let basePriority: 'low' | 'medium' | 'high' | 'urgent' = 'low';
  
  // Check for high priority keywords
  for (const keyword of HIGH_PRIORITY_KEYWORDS) {
    if (combined.includes(keyword)) {
      basePriority = 'high';
      break;
    }
  }
  
  // Check for medium priority keywords if not already high
  if (basePriority === 'low') {
    for (const keyword of MEDIUM_PRIORITY_KEYWORDS) {
      if (combined.includes(keyword)) {
        basePriority = 'medium';
        break;
      }
    }
  }
  
  // VIP customer boost: bump priority one level
  if (customerContext) {
    const isVip = customerContext.isVip || 
      (customerContext.orderCount && customerContext.orderCount >= VIP_ORDER_COUNT_THRESHOLD) ||
      (customerContext.totalSpent && customerContext.totalSpent >= VIP_TOTAL_SPENT_THRESHOLD);
    
    if (isVip) {
      if (basePriority === 'low') return 'medium';
      if (basePriority === 'medium') return 'high';
      if (basePriority === 'high') return 'urgent';
    }
  }
  
  return basePriority;
}

/**
 * Check if a customer qualifies for VIP status
 */
export function isVipCustomer(orderCount: number, totalSpent: number): boolean {
  return orderCount >= VIP_ORDER_COUNT_THRESHOLD || totalSpent >= VIP_TOTAL_SPENT_THRESHOLD;
}
