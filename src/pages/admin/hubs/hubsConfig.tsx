import {
  Wallet, AlertTriangle, DollarSign,
  Headphones, MessageSquare, BarChart3,
  Flame, Film, Globe, Send, Package, Gift,
  BarChart, Activity, TrendingUp, TestTube,
  Home, Store, Archive, Brain, Shield,
} from 'lucide-react';
import { AdminHubTab } from '@/components/admin/AdminHubLayout';

export const getFinanceTabs = (lang: string): AdminHubTab[] => [
  { to: '/admin/payments', icon: Wallet, label: lang === 'fr' ? 'Paiements' : 'Payments', permission: 'can_view_payments' },
  { to: '/admin/abandoned-checkouts', icon: AlertTriangle, label: lang === 'fr' ? 'Paniers abandonnés' : 'Abandoned Checkouts', permission: 'can_view_payments' },
  { to: '/admin/payments-settings', icon: DollarSign, label: lang === 'fr' ? 'Fournisseurs' : 'Providers', permission: 'can_view_payments' },
];

export const getSupportTabs = (lang: string): AdminHubTab[] => [
  { to: '/admin/support-inbox', icon: Headphones, label: lang === 'fr' ? 'Chat en direct' : 'Live Chat', permission: 'can_view_tickets' },
  { to: '/admin/support-contact', icon: MessageSquare, label: lang === 'fr' ? 'Contact Support' : 'Support Contact', permission: 'can_view_tickets' },
  { to: '/admin/chat-routing', icon: BarChart3, label: lang === 'fr' ? 'Routage Chat' : 'Chat Routing', permission: 'can_view_ticket_analytics' },
  { to: '/admin/chatbot-conversations', icon: MessageSquare, label: lang === 'fr' ? 'Conversations Sophie' : 'Sophie Conversations', permission: 'can_view_tickets' },
  { to: '/admin/sophie-analytics', icon: BarChart3, label: lang === 'fr' ? 'Sophie Analytics' : 'Sophie Analytics', permission: 'can_view_ticket_analytics' },
  { to: '/admin/sophie-faqs', icon: Brain, label: lang === 'fr' ? 'Sophie FAQs' : 'Sophie FAQs', permission: 'can_view_tickets' },
  { to: '/admin/payment-escalations', icon: AlertTriangle, label: lang === 'fr' ? 'Escalades Paiement' : 'Payment Escalations', permission: 'can_view_tickets' },
];

export const getMarketingTabs = (lang: string): AdminHubTab[] => [
  { to: '/admin/hot-products', icon: Flame, label: lang === 'fr' ? 'Produits Vedettes' : 'Hot Products', permission: 'can_view_marketing' },
  { to: '/admin/reels', icon: Film, label: lang === 'fr' ? 'Reels' : 'Reels', permission: 'can_view_marketing' },
  { to: '/admin/international-products', icon: Globe, label: lang === 'fr' ? 'Internationaux' : 'International', permission: 'can_view_marketing' },
  { to: '/admin/telegram-import', icon: Send, label: lang === 'fr' ? 'Import Telegram' : 'Telegram Import', permission: 'can_view_marketing' },
  { to: '/admin/bundle-links', icon: Package, label: lang === 'fr' ? 'Packs Produits' : 'Bundle Links', permission: 'can_view_marketing' },
  { to: '/admin/dubai-uploads', icon: Flame, label: lang === 'fr' ? 'Uploads Dubai' : 'Dubai Uploads', permission: 'can_view_marketing' },
  { to: '/admin/referrals', icon: Gift, label: lang === 'fr' ? 'Parrainages' : 'Referrals', permission: 'can_view_marketing' },
];

export const getInsightsTabs = (lang: string): AdminHubTab[] => [
  { to: '/admin/analytics', icon: BarChart, label: 'Analytics', permission: 'can_view_analytics' },
  { to: '/admin/activity-insights', icon: Activity, label: lang === 'fr' ? 'Activité & Funnel' : 'Activity & Funnel', permission: 'can_view_analytics' },
  { to: '/admin/demand-insights', icon: TrendingUp, label: 'Demand Insights', permission: 'can_view_analytics' },
  { to: '/admin/ab-tests', icon: TestTube, label: lang === 'fr' ? 'Tests A/B' : 'A/B Tests', permission: 'can_view_ab_results' },
];

export const getSystemTabs = (lang: string): AdminHubTab[] => [
  { to: '/admin/home-recipes', icon: Home, label: lang === 'fr' ? 'Curation Accueil' : 'Home Curation', permission: 'can_view_settings' },
  { to: '/admin/price-review', icon: Activity, label: lang === 'fr' ? 'Révision Prix' : 'Price Review', permission: 'can_view_settings' },
  { to: '/admin/catalog-sources', icon: Store, label: lang === 'fr' ? 'Config Catalogue' : 'Catalog Config', permission: 'can_view_settings' },
  { to: '/admin/catalog-cache', icon: Archive, label: lang === 'fr' ? 'Cache Catalogue' : 'Catalog Cache', permission: 'can_view_settings' },
  { to: '/admin/auto-learning', icon: Brain, label: 'Auto-Learning', permission: 'can_view_settings' },
  { to: '/admin/health', icon: Activity, label: lang === 'fr' ? 'Santé' : 'Health', permission: 'can_view_dashboard' },
  { to: '/admin/audit-log', icon: Shield, label: lang === 'fr' ? "Journal d'audit" : 'Audit Log', permission: 'can_view_dashboard' },
];
