import { ArrowRight, Download, Package, Globe, Truck, Shield, HeadphonesIcon, Smartphone, CreditCard, MapPin } from "lucide-react";
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
      title: "Select Your Product",
      description: "Browse or paste a product link from supported U.S. stores like Amazon, Walmart, or eBay."
    },
    {
      number: "3",
      title: "Review Pricing",
      description: "AfriShop calculates product cost, shipping, customs, and service fees upfront."
    },
    {
      number: "4",
      title: "Confirm Your Order",
      description: "Review and confirm your order directly inside the app."
    },
    {
      number: "5",
      title: "Complete Payment",
      description: "Pay securely using supported payment providers within the app."
    },
    {
      number: "6",
      title: "We Handle the Rest",
      description: "AfriShop purchases, receives, and ships your product to your destination."
    },
    {
      number: "7",
      title: "Track & Receive",
      description: "Monitor your order status and receive delivery updates until arrival."
    }
  ];

  const services = [
    { icon: Package, title: "Product Purchasing Assistance", description: "We help you order from U.S. stores that don't ship internationally." },
    { icon: Globe, title: "International Shipping Coordination", description: "We coordinate seamless shipping from the U.S. to your country." },
    { icon: Shield, title: "Customs Clearance Support", description: "We assist with customs documentation and clearance processes." },
    { icon: Truck, title: "Local Delivery Coordination", description: "We arrange final delivery to your specified address." },
    { icon: HeadphonesIcon, title: "Customer Support", description: "Our team is available to assist you throughout your order journey." }
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link to="/" className="text-xl font-bold text-foreground">
            AfriShop
          </Link>
          <nav className="hidden md:flex items-center gap-6">
            <Link to="/how-it-works" className="text-sm font-medium text-primary">
              How It Works
            </Link>
            <Link to="/privacy" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
              Privacy
            </Link>
            <Link to="/download" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
              Download App
            </Link>
          </nav>
          <Link to="/download">
            <Button size="sm">
              <Download className="h-4 w-4 mr-2" />
              Get the App
            </Button>
          </Link>
        </div>
      </header>

      {/* Hero Section */}
      <section className="py-16 md:py-24 bg-gradient-to-b from-primary/5 to-background">
        <div className="container mx-auto px-4 text-center">
          <h1 className="text-3xl md:text-5xl font-bold text-foreground mb-6">
            How AfriShop Works
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground max-w-3xl mx-auto">
            Shop from U.S. stores and receive delivery in Africa — all through one simple app.
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
                AfriShop is a mobile application that enables users in Africa to buy products from U.S. online retailers 
                such as Amazon, Walmart, eBay, and others — even if those stores do not ship directly to their country.
              </p>
              <p className="text-muted-foreground leading-relaxed mt-4 text-center">
                AfriShop acts as an intermediary, handling ordering assistance, international shipping, 
                customs coordination, and local delivery.
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
              {/* Vertical line connector */}
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
          <p className="text-center text-muted-foreground mt-8 text-sm">
            AfriShop does NOT manufacture or own the products sold by third-party stores.
          </p>
        </div>
      </section>

      {/* Supported Payments */}
      <section className="py-16 bg-muted/20">
        <div className="container mx-auto px-4">
          <div className="max-w-3xl mx-auto text-center">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-6">
              <CreditCard className="h-8 w-8 text-primary" />
            </div>
            <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-4">
              Supported Payments
            </h2>
            <p className="text-muted-foreground">
              Payments are processed only inside the AfriShop mobile app using licensed third-party payment providers. 
              AfriShop does not store card or mobile money credentials on the website.
            </p>
          </div>
        </div>
      </section>

      {/* Supported Countries */}
      <section className="py-16 bg-background">
        <div className="container mx-auto px-4">
          <div className="max-w-3xl mx-auto text-center">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-6">
              <MapPin className="h-8 w-8 text-primary" />
            </div>
            <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-4">
              Supported Countries
            </h2>
            <p className="text-muted-foreground">
              AfriShop currently focuses on serving users in Africa, including the Democratic Republic of Congo 
              and surrounding regions. Availability may vary by location.
            </p>
          </div>
        </div>
      </section>

      {/* Disclaimer */}
      <section className="py-12 bg-muted/30 border-y border-border/50">
        <div className="container mx-auto px-4">
          <div className="max-w-3xl mx-auto text-center">
            <h3 className="font-semibold text-foreground mb-2">Important Disclaimer</h3>
            <p className="text-sm text-muted-foreground">
              AfriShop is not affiliated with Amazon, Walmart, eBay, or other third-party retailers. 
              All trademarks belong to their respective owners.
            </p>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-16 md:py-24 bg-primary/5">
        <div className="container mx-auto px-4 text-center">
          <Smartphone className="h-16 w-16 text-primary mx-auto mb-6" />
          <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-4">
            Ready to Get Started?
          </h2>
          <p className="text-muted-foreground mb-8 max-w-xl mx-auto">
            Download the AfriShop app to start shopping from U.S. stores today.
          </p>
          <Link to="/download">
            <Button size="lg" className="gap-2">
              Download the AfriShop App
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
            <nav className="flex items-center gap-6">
              <Link to="/how-it-works" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                How It Works
              </Link>
              <Link to="/privacy" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                Privacy
              </Link>
              <Link to="/download" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                Download
              </Link>
            </nav>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default HowItWorks;
