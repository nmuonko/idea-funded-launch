import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Award, Shield, Users, ArrowRight, Sparkles, Scissors, UtensilsCrossed, Hammer, Smartphone, Sprout, Wifi } from 'lucide-react';
import { Link } from 'react-router-dom';
import { AspectRatio } from '@/components/ui/aspect-ratio';
import { HeroCarousel } from '@/components/HeroCarousel';
import afrifundLogo from '@/assets/afrifund-logo.png';

export default function Index() {
  const { t } = useLanguage();

  return (
    <div className="flex flex-col">
      {/* Hero Section - Redesigned Layout */}
      <section className="relative min-h-[90vh] flex items-center overflow-hidden">
        {/* Tesla-style gradient background */}
        <div className="absolute inset-0 bg-gradient-tesla" />
        <div className="absolute inset-0 bg-gradient-glossy opacity-20" />
        
        <div className="container relative z-10 px-4 py-20">
          <div className="grid lg:grid-cols-2 gap-12 items-center max-w-7xl mx-auto">
            {/* Left: Text Content */}
            <div className="space-y-8 text-left">
              <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold text-white animate-fade-in leading-tight">
                {t.home.heroTitle}
              </h1>
              <p className="text-xl md:text-2xl text-white/90 animate-fade-in">
                {t.home.heroSubtitle}
              </p>
              <div className="flex flex-col sm:flex-row gap-4 animate-fade-in">
                <Button
                  asChild
                  size="lg"
                  className="bg-white text-black hover:bg-white/90 shadow-glow hover:shadow-premium transition-smooth"
                >
                  <Link to="/apply">
                    {t.home.submitProject}
                    <ArrowRight className="ml-2 h-5 w-5" />
                  </Link>
                </Button>
                <Button
                  asChild
                  size="lg"
                  variant="outline"
                  className="border-white/30 text-white hover:bg-white/10"
                >
                  <Link to="/how-it-works">
                    {t.home.howItWorks}
                  </Link>
                </Button>
              </div>
            </div>

            {/* Right: Horizontal Rectangular Carousel */}
            <div className="animate-fade-in">
              <div className="relative backdrop-blur-md bg-white/5 rounded-3xl p-6 shadow-premium border border-white/10 hover:scale-105 transition-smooth">
                <AspectRatio ratio={16/10}>
                  <HeroCarousel />
                </AspectRatio>
                <div className="absolute bottom-8 left-8 right-8 text-center">
                  <div className="backdrop-blur-sm bg-black/30 rounded-2xl p-4 flex items-center justify-center gap-3">
                    <Sparkles className="w-6 h-6 text-white animate-pulse" />
                    <p className="text-sm font-semibold text-white">Your Project Could Be Next!</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Decorative Elements */}
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

      {/* Project Ideas Section */}
      <section className="py-16 md:py-24 bg-background">
        <div className="container mx-auto px-4">
          <div className="text-center space-y-4 mb-12">
            <h2 className="text-3xl md:text-4xl font-bold">{t.home.projectIdeasTitle}</h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              {t.home.projectIdeasSubtitle}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-6xl mx-auto">
            <Card className="glass hover:shadow-glow transition-smooth group animate-scale-in">
              <CardHeader>
                <div className="h-14 w-14 rounded-xl bg-gradient-to-br from-primary to-primary/50 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                  <Scissors className="h-7 w-7 text-white" />
                </div>
                <CardTitle className="text-xl">{t.home.project1Title}</CardTitle>
                <CardDescription className="text-base">{t.home.project1Desc}</CardDescription>
              </CardHeader>
            </Card>

            <Card className="glass hover:shadow-glow transition-smooth group animate-scale-in" style={{ animationDelay: '0.1s' }}>
              <CardHeader>
                <div className="h-14 w-14 rounded-xl bg-gradient-to-br from-secondary to-secondary/50 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                  <UtensilsCrossed className="h-7 w-7 text-white" />
                </div>
                <CardTitle className="text-xl">{t.home.project2Title}</CardTitle>
                <CardDescription className="text-base">{t.home.project2Desc}</CardDescription>
              </CardHeader>
            </Card>

            <Card className="glass hover:shadow-glow transition-smooth group animate-scale-in" style={{ animationDelay: '0.2s' }}>
              <CardHeader>
                <div className="h-14 w-14 rounded-xl bg-gradient-to-br from-success to-success/50 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                  <Hammer className="h-7 w-7 text-white" />
                </div>
                <CardTitle className="text-xl">{t.home.project3Title}</CardTitle>
                <CardDescription className="text-base">{t.home.project3Desc}</CardDescription>
              </CardHeader>
            </Card>

            <Card className="glass hover:shadow-glow transition-smooth group animate-scale-in" style={{ animationDelay: '0.3s' }}>
              <CardHeader>
                <div className="h-14 w-14 rounded-xl bg-gradient-to-br from-info to-info/50 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                  <Smartphone className="h-7 w-7 text-white" />
                </div>
                <CardTitle className="text-xl">{t.home.project4Title}</CardTitle>
                <CardDescription className="text-base">{t.home.project4Desc}</CardDescription>
              </CardHeader>
            </Card>

            <Card className="glass hover:shadow-glow transition-smooth group animate-scale-in" style={{ animationDelay: '0.4s' }}>
              <CardHeader>
                <div className="h-14 w-14 rounded-xl bg-gradient-to-br from-warning to-warning/50 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                  <Sprout className="h-7 w-7 text-white" />
                </div>
                <CardTitle className="text-xl">{t.home.project5Title}</CardTitle>
                <CardDescription className="text-base">{t.home.project5Desc}</CardDescription>
              </CardHeader>
            </Card>

            <Card className="glass hover:shadow-glow transition-smooth group animate-scale-in" style={{ animationDelay: '0.5s' }}>
              <CardHeader>
                <div className="h-14 w-14 rounded-xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                  <Wifi className="h-7 w-7 text-white" />
                </div>
                <CardTitle className="text-xl">{t.home.project6Title}</CardTitle>
                <CardDescription className="text-base">{t.home.project6Desc}</CardDescription>
              </CardHeader>
            </Card>
          </div>
        </div>
      </section>

      {/* Who We Are Section */}
      <section className="py-16 md:py-24 bg-muted/30">
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
      <section className="py-16 md:py-24 bg-background">
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
                text: "Grâce à AfriFund, j'ai pu lancer mon petit projet de couture. Le financement m'a permis d'acheter des machines et de former trois autres femmes.",
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

      {/* CTA Section - Tesla-inspired */}
      <section className="py-16 md:py-24 bg-gradient-tesla text-white relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-glossy opacity-20" />
        <div className="container mx-auto px-4 text-center relative z-10">
          <div className="max-w-3xl mx-auto space-y-6">
            <h2 className="text-3xl md:text-4xl font-bold">
              Ready to get started?
            </h2>
            <p className="text-lg text-white/80">
              Join the competition and turn your idea into reality.
            </p>
            <Button asChild size="lg" className="bg-white text-black hover:bg-white/90 shadow-glow">
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
