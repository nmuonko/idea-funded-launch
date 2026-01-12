import { ArrowRight, Download, Package, Globe, Truck, Shield, HeadphonesIcon, Smartphone, XCircle, HelpCircle, LogIn } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const HowItWorks = () => {
  const steps = [
    {
      number: "1",
      title: "Download the App",
      description: "Get the AfriShop mobile app from your device's app store."
    },
    {
      number: "2",
      title: "Submit a Product Link",
      description: "Select or submit a product link from a supported international retailer."
    },
    {
      number: "3",
      title: "Review Cost Estimate",
      description: "AfriShop calculates estimated costs including product price, shipping, customs, and service fees."
    },
    {
      number: "4",
      title: "Confirm Your Order",
      description: "Review and confirm your order within the app."
    },
    {
      number: "5",
      title: "Complete Payment",
      description: "Payment is completed securely inside the app using licensed payment providers."
    },
    {
      number: "6",
      title: "We Coordinate Delivery",
      description: "AfriShop coordinates product purchasing and delivery to your location."
    },
    {
      number: "7",
      title: "Track & Receive",
      description: "Receive order updates and tracking until delivery."
    }
  ];

  const services = [
    { icon: Package, title: "Order Facilitation", description: "We assist with placing orders from international retailers." },
    { icon: Globe, title: "International Shipping", description: "We coordinate shipping logistics from origin to destination." },
    { icon: Shield, title: "Customs Assistance", description: "We help facilitate customs clearance processes." },
    { icon: Truck, title: "Local Delivery", description: "We coordinate last-mile delivery through trusted partners." },
    { icon: HeadphonesIcon, title: "Customer Support", description: "Our team assists with order issues and inquiries." }
  ];

  const limitations = [
    "AfriShop is not affiliated with third-party retailers",
    "AfriShop does not operate an open marketplace",
    "AfriShop does not store sensitive payment credentials",
    "AfriShop does not provide financial services"
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link to="/" className="text-xl font-bold text-foreground">
            AfriShop
          </Link>
          <nav className="hidden md:flex items-center gap-4 text-sm">
            <Link to="/" className="font-medium text-primary">How It Works</Link>
            <Link to="/privacy" className="text-muted-foreground hover:text-foreground transition-colors">Privacy</Link>
            <Link to="/terms" className="text-muted-foreground hover:text-foreground transition-colors">Terms</Link>
            <Link to="/payments-compliance" className="text-muted-foreground hover:text-foreground transition-colors">Payments</Link>
            <Link to="/refunds" className="text-muted-foreground hover:text-foreground transition-colors">Refunds</Link>
          </nav>
          <div className="flex items-center gap-2">
            <Link to="/download" className="hidden sm:inline-flex">
              <Button size="sm">
                <Download className="h-4 w-4 mr-2" />
                Get App
              </Button>
            </Link>
            <Link to="/auth?mode=admin">
              <Button size="sm" variant="ghost">
                <LogIn className="h-4 w-4 mr-2" />
                <span className="hidden sm:inline">Admin</span>
              </Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="py-16 md:py-24 bg-gradient-to-b from-primary/5 to-background">
        <div className="container mx-auto px-4 text-center">
          <h1 className="text-3xl md:text-5xl font-bold text-foreground mb-6">
            How AfriShop Works
          </h1>
          <p className="text-lg text-muted-foreground max-w-3xl mx-auto">
            Ordering assistance and logistics facilitation for international purchases.
          </p>
        </div>
      </section>

      {/* What Is AfriShop */}
      <section className="py-16 bg-background">
        <div className="container mx-auto px-4">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-6 text-center">
              What Is AfriShop?
            </h2>
            <div className="bg-muted/30 rounded-2xl p-6 md:p-8 border border-border/50">
              <p className="text-muted-foreground leading-relaxed text-center">
                AfriShop is a mobile application that assists users in Africa with purchasing products 
                from international online retailers that may not ship directly to their country.
              </p>
              <p className="text-muted-foreground leading-relaxed mt-4 text-center">
                AfriShop provides ordering assistance, international shipping coordination, customs 
                facilitation, and last-mile delivery through trusted partners.
              </p>
              <p className="text-muted-foreground leading-relaxed mt-4 text-center font-medium">
                AfriShop does not manufacture, own, or directly sell third-party products.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Step by Step */}
      <section className="py-16 bg-muted/20">
        <div className="container mx-auto px-4">
          <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-12 text-center">
            How the Service Works
          </h2>
          <div className="max-w-4xl mx-auto">
            <div className="relative">
              <div className="absolute left-6 top-8 bottom-8 w-0.5 bg-border hidden md:block" />
              <div className="space-y-6">
                {steps.map((step, index) => (
                  <div key={index} className="flex gap-4 md:gap-6 items-start">
                    <div className="flex-shrink-0 w-12 h-12 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold text-lg z-10">
                      {step.number}
                    </div>
                    <div className="flex-1 pt-2">
                      <h3 className="font-semibold text-foreground mb-1">{step.title}</h3>
                      <p className="text-muted-foreground">{step.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* What AfriShop Handles */}
      <section className="py-16 bg-background">
        <div className="container mx-auto px-4">
          <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-12 text-center">
            What AfriShop Handles
          </h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {services.map((service, index) => (
              <Card key={index} className="border-border/50 bg-card/50">
                <CardContent className="p-6">
                  <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                    <service.icon className="h-6 w-6 text-primary" />
                  </div>
                  <h3 className="font-semibold text-foreground mb-2">{service.title}</h3>
                  <p className="text-sm text-muted-foreground">{service.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* What AfriShop Does Not Do */}
      <section className="py-16 bg-muted/20">
        <div className="container mx-auto px-4">
          <div className="max-w-3xl mx-auto">
            <div className="flex items-center justify-center gap-3 mb-8">
              <XCircle className="h-8 w-8 text-muted-foreground" />
              <h2 className="text-2xl md:text-3xl font-bold text-foreground">
                What AfriShop Does Not Do
              </h2>
            </div>
            <div className="space-y-3">
              {limitations.map((item, index) => (
                <div key={index} className="flex items-start gap-3 bg-background rounded-lg p-4 border border-border/50">
                  <span className="text-muted-foreground mt-0.5">•</span>
                  <p className="text-muted-foreground">{item}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Disclaimer */}
      <section className="py-12 bg-muted/30 border-y border-border/50">
        <div className="container mx-auto px-4">
          <div className="max-w-3xl mx-auto text-center">
            <HelpCircle className="h-8 w-8 text-muted-foreground mx-auto mb-4" />
            <h3 className="font-semibold text-foreground mb-2">Disclaimer</h3>
            <p className="text-sm text-muted-foreground">
              All third-party trademarks belong to their respective owners. AfriShop operates independently 
              and is not affiliated with any third-party retailer or brand mentioned.
            </p>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-16 md:py-24 bg-primary/5">
        <div className="container mx-auto px-4 text-center">
          <Smartphone className="h-16 w-16 text-primary mx-auto mb-6" />
          <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-4">
            Download the AfriShop App
          </h2>
          <p className="text-muted-foreground mb-8 max-w-xl mx-auto">
            Get started with AfriShop by downloading our mobile application.
          </p>
          <Link to="/download">
            <Button size="lg" className="gap-2">
              Download the App
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 border-t border-border/40 bg-background">
        <div className="container mx-auto px-4">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              © {new Date().getFullYear()} AfriShop. All rights reserved.
            </p>
          <nav className="flex flex-wrap items-center justify-center gap-4 md:gap-6 text-sm">
              <Link to="/" className="text-muted-foreground hover:text-foreground transition-colors">How It Works</Link>
              <Link to="/privacy" className="text-muted-foreground hover:text-foreground transition-colors">Privacy</Link>
              <Link to="/terms" className="text-muted-foreground hover:text-foreground transition-colors">Terms</Link>
              <Link to="/payments-compliance" className="text-muted-foreground hover:text-foreground transition-colors">Payments</Link>
              <Link to="/refunds" className="text-muted-foreground hover:text-foreground transition-colors">Refunds</Link>
              <Link to="/download" className="text-muted-foreground hover:text-foreground transition-colors">Download</Link>
            </nav>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default HowItWorks;
