import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { SUPPORT_WHATSAPP_E164, SUPPORT_EMAIL } from '@/lib/supportConfig';

export function useSupportContact() {
  const { data } = useQuery({
    queryKey: ['support-contact-settings'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('settings')
        .select('support_whatsapp, support_email')
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error('Failed to fetch support contact:', error);
        return null;
      }
      return data;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000,
  });

  const whatsapp = data?.support_whatsapp || SUPPORT_WHATSAPP_E164;
  const email = data?.support_email || SUPPORT_EMAIL;

  return {
    whatsapp,
    email,
    whatsappUrl: (_userEmail?: string | null) => {
      const message = `Bonjour L'Equipe AfriShop,\n\nJe suis prêt à commander. Si j'ai un souci avant le paiement, j'aurai besoin de votre aide.`;
      return `https://wa.me/${whatsapp.replace(/[^0-9]/g, '')}?text=${encodeURIComponent(message)}`;
    },
    emailUrl: (userEmail?: string | null) => {
      const subject = 'AfriShop Support Request';
      const body = `Hello AfriShop Support Team,\n\nI need assistance with my order.\n\nMy account email: ${userEmail || 'Not logged in'}\n\nPlease describe your issue below:\n\n`;
      return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    },
  };
}
