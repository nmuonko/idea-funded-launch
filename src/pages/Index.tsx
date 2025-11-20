import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Award, Shield, Users, ArrowRight, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { AspectRatio } from '@/components/ui/aspect-ratio';

export default function Index() {
  const { t } = useLanguage();

  return (
    <div className="flex flex-col">
      {/* Hero Section */}
      <section className="relative bg-gradient-primary text-primary-foreground overflow-hidden">
        <div className="absolute inset-0 bg-gradient-radial opacity-30" />
        
        {/* Floating Video/Image Element */}
        <div className="absolute right-0 top-1/2 -translate-y-1/2 w-[500px] h-[500px] hidden lg:block animate-[float_6s_ease-in-out_infinite] opacity-90">
          <div className="relative w-full h-full">
            <div className="absolute inset-0 bg-gradient-glow rounded-3xl blur-3xl opacity-40 animate-pulse" />
            <div className="relative glass-strong rounded-3xl p-4 shadow-premium border-2 border-primary-foreground/20 hover:scale-105 transition-smooth">
              <AspectRatio ratio={1}>
                <div className="relative w-full h-full bg-gradient-subtle rounded-2xl overflow-hidden group">
                  <video 
                    autoPlay 
                    muted 
                    loop 
                    playsInline
                    className="w-full h-full object-cover"
                    poster="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 400'%3E%3Crect fill='%23667eea' width='400' height='400'/%3E%3C/svg%3E"
                  >
                    <source src="https://assets.mixkit.co/videos/preview/mixkit-digital-animation-of-futuristic-devices-99790-large.mp4" type="video/mp4" />
                  </video>
                  <div className="absolute inset-0 bg-gradient-to-t from-primary/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 flex items-end justify-center pb-8">
                    <div className="text-center space-y-2">
                      <Sparkles className="w-8 h-8 mx-auto text-warning animate-pulse" />
                      <p className="text-sm font-semibold text-primary-foreground">Your Project Could Be Next!</p>
                    </div>
                  </div>
                </div>
              </AspectRatio>
            </div>
          </div>
        </div>

        <div className="container mx-auto px-4 py-24 md:py-40 relative z-10">
          <div className="max-w-4xl mx-auto lg:max-w-2xl text-center space-y-8 animate-fade-in">
            <h1 className="text-5xl md:text-7xl font-bold leading-tight">
              {t.home.heroTitle}
            </h1>
            <p className="text-xl md:text-2xl text-primary-foreground/90 max-w-2xl mx-auto">
              {t.home.heroSubtitle}
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center pt-6">
              <Button asChild size="lg" variant="secondary" className="shadow-glow hover:shadow-premium transition-smooth">
                <Link to="/apply">
                  {t.home.submitProject}
                  <ArrowRight className="ml-2 h-5 w-5" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="glass text-primary-foreground border-primary-foreground/30 hover:bg-primary-foreground/20">
                <Link to="/how-it-works">
                  {t.home.howItWorks}
                </Link>
              </Button>
            </div>
          </div>
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-background to-transparent" />
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
            <Card className="glass hover:shadow-glow transition-smooth group animate-scale-in">
              <CardHeader>
                <div className="h-14 w-14 rounded-xl bg-gradient-to-br from-success to-success/50 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                  <Award className="h-7 w-7 text-white" />
                </div>
                <CardTitle className="text-xl">{t.home.seedFunding}</CardTitle>
                <CardDescription className="text-base">{t.home.seedFundingDesc}</CardDescription>
              </CardHeader>
            </Card>

            <Card className="glass hover:shadow-glow transition-smooth group animate-scale-in" style={{ animationDelay: '0.1s' }}>
              <CardHeader>
                <div className="h-14 w-14 rounded-xl bg-gradient-to-br from-info to-info/50 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                  <Shield className="h-7 w-7 text-white" />
                </div>
                <CardTitle className="text-xl">{t.home.transparentSelection}</CardTitle>
                <CardDescription className="text-base">{t.home.transparentSelectionDesc}</CardDescription>
              </CardHeader>
            </Card>

            <Card className="glass hover:shadow-glow transition-smooth group animate-scale-in" style={{ animationDelay: '0.2s' }}>
              <CardHeader>
                <div className="h-14 w-14 rounded-xl bg-gradient-to-br from-secondary to-secondary/50 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                  <Users className="h-7 w-7 text-white" />
                </div>
                <CardTitle className="text-xl">{t.home.communityImpact}</CardTitle>
                <CardDescription className="text-base">{t.home.communityImpactDesc}</CardDescription>
              </CardHeader>
            </Card>
          </div>
        </div>
      </section>

      {/* Who We Are Section */}
      <section className="py-16 md:py-24 bg-background">
        <div className="container mx-auto px-4">
          <div className="max-w-4xl mx-auto">
            <Card className="glass-strong shadow-premium">
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

      {/* Testimonials Section */}
      <section className="py-16 md:py-24 bg-muted/30">
        <div className="container mx-auto px-4">
          <div className="text-center space-y-4 mb-12">
            <h2 className="text-3xl md:text-4xl font-bold">Success Stories</h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Hear from winners who turned their ideas into reality
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-6xl mx-auto">
            {[
              {
                name: "Marie K.",
                location: "Lubumbashi",
                session: "Session 3 Winner",
                text: "Grâce à Project Competition, j'ai pu lancer mon petit projet de couture. Le financement m'a permis d'acheter des machines et de former trois autres femmes.",
                rating: 5,
              },
              {
                name: "Jean-Paul M.",
                location: "Kinshasa",
                session: "Session 2 Winner",
                text: "J'ai toujours rêvé de créer une entreprise de technologie. Maintenant, avec le soutien reçu, nous développons des solutions pour notre communauté.",
                rating: 5,
              },
              {
                name: "Amani T.",
                location: "Goma",
                session: "Session 4 Winner",
                text: "Mon projet agricole a transformé non seulement ma vie, mais aussi celle de ma communauté. Merci pour cette opportunité incroyable!",
                rating: 5,
              },
            ].map((testimonial, index) => (
              <Card key={index} className="glass hover:shadow-glow transition-smooth animate-slide-up" style={{ animationDelay: `${index * 0.1}s` }}>
                <CardHeader>
                  <div className="flex items-center gap-4">
                    <div className="h-12 w-12 rounded-full bg-gradient-glow flex items-center justify-center text-white font-bold text-xl">
                      {testimonial.name.charAt(0)}
                    </div>
                    <div className="flex-1">
                      <CardTitle className="text-lg">{testimonial.name}</CardTitle>
                      <CardDescription className="text-sm">{testimonial.location}</CardDescription>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <Badge variant="outline" className="text-xs">{testimonial.session}</Badge>
                    <div className="flex gap-0.5">
                      {Array.from({ length: testimonial.rating }).map((_, i) => (
                        <span key={i} className="text-warning">★</span>
                      ))}
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground italic">"{testimonial.text}"</p>
                </CardContent>
              </Card>
            ))}
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
