import { useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Mail, Phone, MapPin } from 'lucide-react';
import { z } from 'zod';
const contactSchema = z.object({
  fullName: z.string().trim().min(1, 'Full name is required').max(100, 'Full name must be less than 100 characters'),
  email: z.string().trim().email('Invalid email address').max(255, 'Email must be less than 255 characters'),
  whatsappNumber: z.string().trim().max(20, 'WhatsApp number must be less than 20 characters').optional(),
  subject: z.string().trim().min(1, 'Subject is required').max(200, 'Subject must be less than 200 characters'),
  message: z.string().trim().min(1, 'Message is required').max(5000, 'Message must be less than 5000 characters')
});
export default function Contact() {
  const {
    t
  } = useLanguage();
  const {
    toast
  } = useToast();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    whatsappNumber: '',
    subject: '',
    message: ''
  });
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      // Validate form data
      const result = contactSchema.safeParse(formData);
      if (!result.success) {
        toast({
          title: t.common.error,
          description: result.error.issues[0].message,
          variant: 'destructive'
        });
        setLoading(false);
        return;
      }
      const {
        error
      } = await supabase.from('contact_messages').insert({
        full_name: result.data.fullName,
        email: result.data.email,
        whatsapp_number: result.data.whatsappNumber || null,
        subject: result.data.subject,
        message: result.data.message
      });
      if (error) throw error;
      toast({
        title: t.common.success,
        description: t.contact.messageSent
      });
      setFormData({
        fullName: '',
        email: '',
        whatsappNumber: '',
        subject: '',
        message: ''
      });
    } catch (error) {
      console.error('Error sending message:', error);
      toast({
        title: t.common.error,
        description: t.contact.messageError,
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };
  return <div className="py-16 md:py-24">
      <div className="container mx-auto px-4">
        {/* Header */}
        <div className="text-center space-y-4 mb-16">
          <h1 className="text-4xl md:text-5xl font-bold">{t.contact.title}</h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            {t.contact.subtitle}
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 max-w-6xl mx-auto">
          {/* About Us Section */}
          <div className="space-y-6">
            <Card className="shadow-card">
              <CardHeader>
                <CardTitle className="text-2xl">{t.contact.aboutUs}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <p className="text-muted-foreground">
                  {t.contact.aboutText}
                </p>

                <div className="space-y-4">
                  <div className="flex items-start gap-3">
                    <div>
                      <p className="font-semibold mb-2">{t.contact.contactEmail}</p>
                      <a 
                        href="mailto:info@afri-fund.org" 
                        className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-primary hover:bg-primary/90 text-white transition-colors"
                        title="Email us"
                      >
                        <Mail className="h-5 w-5" />
                      </a>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <div>
                      <p className="font-semibold mb-2">{t.contact.contactWhatsApp}</p>
                      <a 
                        href="https://wa.me/243972809832" 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-green-500 hover:bg-green-600 text-white transition-colors text-sm font-medium"
                        title="Chat on WhatsApp"
                      >
                        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                        </svg>
                        Chat on WhatsApp
                      </a>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <MapPin className="h-5 w-5 text-primary mt-0.5" />
                    <div>
                      <p className="font-semibold">{t.contact.contactLocation}</p>
                      <p className="text-sm text-muted-foreground">Lubumbashi, DRC</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Contact Form */}
          <Card className="shadow-card">
            <CardHeader>
              <CardTitle className="text-2xl">{t.contact.formTitle}</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="fullName">
                    {t.contact.fullName} <span className="text-destructive">*</span>
                  </Label>
                  <Input id="fullName" value={formData.fullName} onChange={e => setFormData({
                  ...formData,
                  fullName: e.target.value
                })} maxLength={100} required />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email">
                    {t.contact.email} <span className="text-destructive">*</span>
                  </Label>
                  <Input id="email" type="email" value={formData.email} onChange={e => setFormData({
                  ...formData,
                  email: e.target.value
                })} maxLength={255} required />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="whatsappNumber">{t.contact.whatsappNumber}</Label>
                  <Input id="whatsappNumber" type="tel" value={formData.whatsappNumber} onChange={e => setFormData({
                  ...formData,
                  whatsappNumber: e.target.value
                })} maxLength={20} />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="subject">
                    {t.contact.subject} <span className="text-destructive">*</span>
                  </Label>
                  <Input id="subject" value={formData.subject} onChange={e => setFormData({
                  ...formData,
                  subject: e.target.value
                })} maxLength={200} required />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="message">
                    {t.contact.message} <span className="text-destructive">*</span>
                  </Label>
                  <Textarea id="message" rows={6} value={formData.message} onChange={e => setFormData({
                  ...formData,
                  message: e.target.value
                })} maxLength={5000} required />
                </div>

                <Button type="submit" disabled={loading} className="w-full">
                  {loading ? t.common.loading : t.contact.sendMessage}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>;
}