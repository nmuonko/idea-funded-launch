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

export default function Contact() {
  const { t } = useLanguage();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    whatsappNumber: '',
    subject: '',
    message: '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const { error } = await supabase.from('contact_messages').insert({
        full_name: formData.fullName,
        email: formData.email,
        whatsapp_number: formData.whatsappNumber || null,
        subject: formData.subject,
        message: formData.message,
      });

      if (error) throw error;

      toast({
        title: t.common.success,
        description: t.contact.messageSent,
      });

      setFormData({
        fullName: '',
        email: '',
        whatsappNumber: '',
        subject: '',
        message: '',
      });
    } catch (error) {
      console.error('Error sending message:', error);
      toast({
        title: t.common.error,
        description: t.contact.messageError,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="py-16 md:py-24">
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
                    <Mail className="h-5 w-5 text-primary mt-0.5" />
                    <div>
                      <p className="font-semibold">{t.contact.contactEmail}</p>
                      <p className="text-sm text-muted-foreground">contact@projectcompetition.org</p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <Phone className="h-5 w-5 text-primary mt-0.5" />
                    <div>
                      <p className="font-semibold">{t.contact.contactWhatsApp}</p>
                      <p className="text-sm text-muted-foreground">+243 XXX XXX XXX</p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <MapPin className="h-5 w-5 text-primary mt-0.5" />
                    <div>
                      <p className="font-semibold">{t.contact.contactLocation}</p>
                      <p className="text-sm text-muted-foreground">Kinshasa, DRC</p>
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
                  <Input
                    id="fullName"
                    value={formData.fullName}
                    onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email">
                    {t.contact.email} <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="whatsappNumber">{t.contact.whatsappNumber}</Label>
                  <Input
                    id="whatsappNumber"
                    type="tel"
                    value={formData.whatsappNumber}
                    onChange={(e) => setFormData({ ...formData, whatsappNumber: e.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="subject">
                    {t.contact.subject} <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="subject"
                    value={formData.subject}
                    onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="message">
                    {t.contact.message} <span className="text-destructive">*</span>
                  </Label>
                  <Textarea
                    id="message"
                    rows={6}
                    value={formData.message}
                    onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                    required
                  />
                </div>

                <Button type="submit" disabled={loading} className="w-full">
                  {loading ? t.common.loading : t.contact.sendMessage}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
