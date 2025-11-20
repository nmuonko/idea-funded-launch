import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Award, Shield, Users, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function Index() {
  const { t } = useLanguage();

  return (
    <div className="flex flex-col">
      {/* Hero Section */}
      <section className="relative bg-gradient-primary text-primary-foreground">
        <div className="container mx-auto px-4 py-20 md:py-32">
          <div className="max-w-4xl mx-auto text-center space-y-6">
            <h1 className="text-4xl md:text-6xl font-bold leading-tight">
              {t.home.heroTitle}
            </h1>
            <p className="text-lg md:text-xl text-primary-foreground/90 max-w-2xl mx-auto">
              {t.home.heroSubtitle}
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center pt-4">
              <Button asChild size="lg" variant="secondary">
                <Link to="/apply">
                  {t.home.submitProject}
                  <ArrowRight className="ml-2 h-5 w-5" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="bg-primary-foreground/10 text-primary-foreground border-primary-foreground/20 hover:bg-primary-foreground/20">
                <Link to="/how-it-works">
                  {t.home.howItWorks}
                </Link>
              </Button>
            </div>
          </div>
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-background to-transparent" />
      </section>

      {/* Mission Section */}
      <section className="py-16 md:py-24 bg-background">
        <div className="container mx-auto px-4">
          <div className="max-w-4xl mx-auto">
            <div className="text-center space-y-4 mb-12">
              <h2 className="text-3xl md:text-4xl font-bold">{t.home.missionTitle}</h2>
              <p className="text-lg text-muted-foreground">
                {t.home.missionBody}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* What You Get Section */}
      <section className="py-16 md:py-24 bg-muted/50">
        <div className="container mx-auto px-4">
          <div className="text-center space-y-4 mb-12">
            <h2 className="text-3xl md:text-4xl font-bold">{t.home.whatYouGetTitle}</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-6xl mx-auto">
            <Card className="shadow-card hover:shadow-elegant transition-shadow">
              <CardHeader>
                <div className="h-12 w-12 rounded-lg bg-success/10 flex items-center justify-center mb-4">
                  <Award className="h-6 w-6 text-success" />
                </div>
                <CardTitle>{t.home.seedFunding}</CardTitle>
                <CardDescription>{t.home.seedFundingDesc}</CardDescription>
              </CardHeader>
            </Card>

            <Card className="shadow-card hover:shadow-elegant transition-shadow">
              <CardHeader>
                <div className="h-12 w-12 rounded-lg bg-info/10 flex items-center justify-center mb-4">
                  <Shield className="h-6 w-6 text-info" />
                </div>
                <CardTitle>{t.home.transparentSelection}</CardTitle>
                <CardDescription>{t.home.transparentSelectionDesc}</CardDescription>
              </CardHeader>
            </Card>

            <Card className="shadow-card hover:shadow-elegant transition-shadow">
              <CardHeader>
                <div className="h-12 w-12 rounded-lg bg-secondary/10 flex items-center justify-center mb-4">
                  <Users className="h-6 w-6 text-secondary" />
                </div>
                <CardTitle>{t.home.communityImpact}</CardTitle>
                <CardDescription>{t.home.communityImpactDesc}</CardDescription>
              </CardHeader>
            </Card>
          </div>
        </div>
      </section>

      {/* Who We Are Section */}
      <section className="py-16 md:py-24 bg-background">
        <div className="container mx-auto px-4">
          <div className="max-w-4xl mx-auto">
            <Card className="shadow-elegant">
              <CardHeader>
                <CardTitle className="text-2xl md:text-3xl">{t.home.whoWeAreTitle}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-lg text-muted-foreground">
                  {t.home.whoWeAreBody}
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-16 md:py-24 bg-gradient-primary text-primary-foreground">
        <div className="container mx-auto px-4 text-center">
          <div className="max-w-3xl mx-auto space-y-6">
            <h2 className="text-3xl md:text-4xl font-bold">
              Ready to get started?
            </h2>
            <p className="text-lg text-primary-foreground/90">
              Join the competition and turn your idea into reality.
            </p>
            <Button asChild size="lg" variant="secondary">
              <Link to="/apply">
                {t.home.submitProject}
                <ArrowRight className="ml-2 h-5 w-5" />
              </Link>
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
