import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function Terms() {
  const { t } = useLanguage();

  const sections = [
    {
      title: t.terms.eligibilityTitle,
      content: t.terms.eligibilityText,
    },
    {
      title: t.terms.feeTitle,
      content: t.terms.feeText,
    },
    {
      title: t.terms.paymentMethodsTitle,
      content: t.terms.paymentMethodsText,
    },
    {
      title: t.terms.selectionTitle,
      content: t.terms.selectionText,
    },
    {
      title: t.terms.privacyTitle,
      content: t.terms.privacyText,
    },
  ];

  return (
    <div className="py-16 md:py-24">
      <div className="container mx-auto px-4">
        {/* Header */}
        <div className="text-center space-y-4 mb-16">
          <h1 className="text-4xl md:text-5xl font-bold">{t.terms.title}</h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            {t.terms.subtitle}
          </p>
        </div>

        {/* Terms Content */}
        <div className="max-w-4xl mx-auto space-y-6">
          {sections.map((section, index) => (
            <Card key={index} className="shadow-card">
              <CardHeader>
                <CardTitle className="text-2xl">{section.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground text-lg">{section.content}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
