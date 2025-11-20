import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Lightbulb, FileText, DollarSign, Eye, TrendingUp, Trophy } from 'lucide-react';

export default function HowItWorks() {
  const { t } = useLanguage();

  const steps = [
    {
      icon: Lightbulb,
      title: t.howItWorks.step1Title,
      description: t.howItWorks.step1Desc,
    },
    {
      icon: FileText,
      title: t.howItWorks.step2Title,
      description: t.howItWorks.step2Desc,
    },
    {
      icon: DollarSign,
      title: t.howItWorks.step3Title,
      description: t.howItWorks.step3Desc,
    },
    {
      icon: Eye,
      title: t.howItWorks.step4Title,
      description: t.howItWorks.step4Desc,
    },
    {
      icon: TrendingUp,
      title: t.howItWorks.step5Title,
      description: t.howItWorks.step5Desc,
    },
    {
      icon: Trophy,
      title: t.howItWorks.step6Title,
      description: t.howItWorks.step6Desc,
    },
  ];

  const faqs = [
    { q: t.faq.q1, a: t.faq.a1 },
    { q: t.faq.q2, a: t.faq.a2 },
    { q: t.faq.q3, a: t.faq.a3 },
    { q: t.faq.q4, a: t.faq.a4 },
    { q: t.faq.q5, a: t.faq.a5 },
    { q: t.faq.q6, a: t.faq.a6 },
    { q: t.faq.q7, a: t.faq.a7 },
  ];

  return (
    <div className="py-16 md:py-24">
      <div className="container mx-auto px-4">
        {/* Header */}
        <div className="text-center space-y-4 mb-16">
          <h1 className="text-4xl md:text-5xl font-bold">{t.howItWorks.title}</h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            {t.howItWorks.subtitle}
          </p>
        </div>

        {/* Steps */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-6xl mx-auto mb-20">
          {steps.map((step, index) => {
            const Icon = step.icon;
            return (
              <Card key={index} className="shadow-card hover:shadow-elegant transition-shadow">
                <CardHeader>
                  <div className="flex items-center gap-4 mb-2">
                    <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <Icon className="h-6 w-6 text-primary" />
                    </div>
                    <div className="h-8 w-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold flex-shrink-0">
                      {index + 1}
                    </div>
                  </div>
                  <CardTitle className="text-xl">{step.title}</CardTitle>
                  <CardDescription className="text-base">{step.description}</CardDescription>
                </CardHeader>
              </Card>
            );
          })}
        </div>

        {/* FAQ Section */}
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-center mb-8">
            {t.howItWorks.faqTitle}
          </h2>
          
          <Accordion type="single" collapsible className="space-y-4">
            {faqs.map((faq, index) => (
              <AccordionItem key={index} value={`item-${index}`} className="border rounded-lg px-6 shadow-card">
                <AccordionTrigger className="text-left hover:no-underline py-4">
                  <span className="font-semibold">{faq.q}</span>
                </AccordionTrigger>
                <AccordionContent className="text-muted-foreground pb-4">
                  {faq.a}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </div>
    </div>
  );
}
