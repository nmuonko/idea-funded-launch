import { Link } from "react-router-dom";
import { Download, Smartphone, ShoppingCart, Truck, CreditCard, Bell, HeadphonesIcon, Globe, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const DownloadPage = () => {
  const features = [
    {
      icon: ShoppingCart,
      title: "Shop U.S. Stores",
      description: "Access products from Amazon, Walmart, eBay, and more"
    },
    {
      icon: Globe,
      title: "International Shipping",
      description: "We handle shipping from the U.S. to your location"
    },
    {
      icon: CreditCard,
      title: "Secure Payments",
      description: "Pay safely using licensed payment providers"
    },
    {
      icon: Truck,
      title: "Order Tracking",
      description: "Track your order from purchase to delivery"
    },
    {
      icon: Bell,
      title: "Real-time Updates",
      description: "Get notifications on your order status"
    },
    {
      icon: HeadphonesIcon,
      title: "Customer Support",
      description: "Access support directly within the app"
    }
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
            <Link to="/how-it-works" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
              How It Works
            </Link>
            <Link to="/privacy" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
              Privacy
            </Link>
            <Link to="/download" className="text-sm font-medium text-primary">
              Download App
            </Link>
          </nav>
          <Button size="sm" variant="outline">
            <Download className="h-4 w-4 mr-2" />
            Get the App
          </Button>
        </div>
      </header>

      {/* Hero Section */}
      <section className="py-16 md:py-24 bg-gradient-to-b from-primary/5 to-background">
        <div className="container mx-auto px-4">
          <div className="max-w-3xl mx-auto text-center">
            <div className="w-20 h-20 rounded-3xl bg-primary/10 flex items-center justify-center mx-auto mb-8">
              <Smartphone className="h-10 w-10 text-primary" />
            </div>
            <h1 className="text-3xl md:text-5xl font-bold text-foreground mb-6">
              Download the AfriShop App
            </h1>
            <p className="text-lg text-muted-foreground mb-8">
              AfriShop operates primarily through its mobile application. Download the app to start 
              shopping from U.S. stores and receive delivery in Africa.
            </p>
            
            {/* Download Buttons */}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <a 
                href="https://play.google.com/store" 
                target="_blank" 
                rel="noopener noreferrer"
                className="w-full sm:w-auto"
              >
                <Button size="lg" className="w-full sm:w-auto gap-3 h-14 px-6">
                  <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor">
                    <path d="M3,20.5V3.5C3,2.91 3.34,2.39 3.84,2.15L13.69,12L3.84,21.85C3.34,21.6 3,21.09 3,20.5M16.81,15.12L6.05,21.34L14.54,12.85L16.81,15.12M20.16,10.81C20.5,11.08 20.75,11.5 20.75,12C20.75,12.5 20.5,12.92 20.16,13.19L17.89,14.5L15.39,12L17.89,9.5L20.16,10.81M6.05,2.66L16.81,8.88L14.54,11.15L6.05,2.66Z" />
                  </svg>
                  <div className="text-left">
                    <div className="text-xs opacity-80">Get it on</div>
                    <div className="text-sm font-semibold">Google Play</div>
                  </div>
                </Button>
              </a>
              
              <a 
                href="https://apps.apple.com" 
                target="_blank" 
                rel="noopener noreferrer"
                className="w-full sm:w-auto"
              >
                <Button size="lg" variant="outline" className="w-full sm:w-auto gap-3 h-14 px-6">
                  <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor">
                    <path d="M18.71,19.5C17.88,20.74 17,21.95 15.66,21.97C14.32,22 13.89,21.18 12.37,21.18C10.84,21.18 10.37,21.95 9.1,22C7.79,22.05 6.8,20.68 5.96,19.47C4.25,17 2.94,12.45 4.7,9.39C5.57,7.87 7.13,6.91 8.82,6.88C10.1,6.86 11.32,7.75 12.11,7.75C12.89,7.75 14.37,6.68 15.92,6.84C16.57,6.87 18.39,7.1 19.56,8.82C19.47,8.88 17.39,10.1 17.41,12.63C17.44,15.65 20.06,16.66 20.09,16.67C20.06,16.74 19.67,18.11 18.71,19.5M13,3.5C13.73,2.67 14.94,2.04 15.94,2C16.07,3.17 15.6,4.35 14.9,5.19C14.21,6.04 13.07,6.7 11.95,6.61C11.8,5.46 12.36,4.26 13,3.5Z" />
                  </svg>
                  <div className="text-left">
                    <div className="text-xs opacity-80">Download on the</div>
                    <div className="text-sm font-semibold">App Store</div>
                  </div>
                </Button>
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Why the App */}
      <section className="py-16 bg-muted/20">
        <div className="container mx-auto px-4">
          <div className="max-w-3xl mx-auto text-center mb-12">
            <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-4">
              Why Use the AfriShop App?
            </h2>
            <p className="text-muted-foreground">
              The AfriShop mobile app is required to place orders, make payments, and track deliveries. 
              All core functionality is available exclusively in the app for security and convenience.
            </p>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-16 bg-background">
        <div className="container mx-auto px-4">
          <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-12 text-center">
            Features Available in the App
          </h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {features.map((feature, index) => (
              <Card key={index} className="border-border/50 bg-card/50">
                <CardContent className="p-6">
                  <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                    <feature.icon className="h-6 w-6 text-primary" />
                  </div>
                  <h3 className="font-semibold text-foreground mb-2">{feature.title}</h3>
                  <p className="text-sm text-muted-foreground">{feature.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* How to Get Started */}
      <section className="py-16 bg-muted/20">
        <div className="container mx-auto px-4">
          <div className="max-w-3xl mx-auto">
            <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-8 text-center">
              How to Get Started
            </h2>
            <div className="space-y-4">
              <div className="flex items-start gap-4 bg-background rounded-xl p-4 border border-border/50">
                <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold flex-shrink-0">
                  1
                </div>
                <div>
                  <h3 className="font-semibold text-foreground">Download the App</h3>
                  <p className="text-sm text-muted-foreground">Get AfriShop from Google Play or the App Store</p>
                </div>
              </div>
              <div className="flex items-start gap-4 bg-background rounded-xl p-4 border border-border/50">
                <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold flex-shrink-0">
                  2
                </div>
                <div>
                  <h3 className="font-semibold text-foreground">Create an Account</h3>
                  <p className="text-sm text-muted-foreground">Sign up with your email or phone number</p>
                </div>
              </div>
              <div className="flex items-start gap-4 bg-background rounded-xl p-4 border border-border/50">
                <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold flex-shrink-0">
                  3
                </div>
                <div>
                  <h3 className="font-semibold text-foreground">Start Shopping</h3>
                  <p className="text-sm text-muted-foreground">Browse or paste product links from U.S. stores</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-16 md:py-20 bg-primary/5">
        <div className="container mx-auto px-4 text-center">
          <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-4">
            Ready to Shop from the U.S.?
          </h2>
          <p className="text-muted-foreground mb-8 max-w-xl mx-auto">
            Download the AfriShop app and start ordering products from your favorite U.S. stores today.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <a href="https://play.google.com/store" target="_blank" rel="noopener noreferrer">
              <Button size="lg" className="gap-2">
                Download Now
                <ArrowRight className="h-4 w-4" />
              </Button>
            </a>
            <Link to="/how-it-works">
              <Button size="lg" variant="outline">
                Learn More
              </Button>
            </Link>
          </div>
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

export default DownloadPage;
