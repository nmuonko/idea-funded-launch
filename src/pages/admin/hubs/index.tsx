import { useLanguage } from '@/contexts/LanguageContext';
import { AdminHubLayout } from '@/components/admin/AdminHubLayout';
import {
  getFinanceTabs,
  getSupportTabs,
  getMarketingTabs,
  getInsightsTabs,
  getSystemTabs,
} from './hubsConfig';

export function FinanceHub() {
  const { language } = useLanguage();
  return <AdminHubLayout title={language === 'fr' ? 'Finance' : 'Finance'} tabs={getFinanceTabs(language)} />;
}

export function SupportHub() {
  const { language } = useLanguage();
  return <AdminHubLayout title={language === 'fr' ? 'Support' : 'Support'} tabs={getSupportTabs(language)} />;
}

export function MarketingHub() {
  const { language } = useLanguage();
  return <AdminHubLayout title={language === 'fr' ? 'Marketing' : 'Marketing'} tabs={getMarketingTabs(language)} />;
}

export function InsightsHub() {
  const { language } = useLanguage();
  return <AdminHubLayout title={language === 'fr' ? 'Insights' : 'Insights'} tabs={getInsightsTabs(language)} />;
}

export function SystemHub() {
  const { language } = useLanguage();
  return <AdminHubLayout title={language === 'fr' ? 'Système' : 'System'} tabs={getSystemTabs(language)} />;
}
