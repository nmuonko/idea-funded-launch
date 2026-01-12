import { Link } from "react-router-dom";
import { Download, Smartphone, ShoppingCart, Truck, CreditCard, Bell, HeadphonesIcon, Globe, ArrowRight, Shield, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import afrishopLogo from "@/assets/afrishop-logo.png";

const DownloadPage = () => {
  const features = [
    {
      icon: CreditCard,
      title: "Secure In-App Payments",
      description: "Pay safely using licensed payment providers"
    },
    {
      icon: Truck,
      title: "Order Tracking",
      description: "Monitor your order from purchase to delivery"
    },
    {
      icon: HeadphonesIcon,
      title: "Customer Support",
      description: "Access support directly within the app"
    },
    {
      icon: Bell,
      title: "Delivery Updates",
      description: "Receive notifications on order status changes"
    },
    {
      icon: Shield,
      title: "Identity Verification",
      description: "Secure account verification for your protection"
    },
    {
      icon: Globe,
      title: "International Access",
      description: "Shop from retailers that may not ship directly"
    }
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link to="/" className="flex items-center">
            <img src={afrishopLogo} alt="AfriShop" className="h-10 md:h-12 drop-shadow-md" />
          </Link>
          <nav className="hidden md:flex items-center gap-4 text-sm">
            <Link to="/" className="text-muted-foreground hover:text-foreground transition-colors">How It Works</Link>
            <Link to="/privacy" className="text-muted-foreground hover:text-foreground transition-colors">Privacy</Link>
            <Link to="/terms" className="text-muted-foreground hover:text-foreground transition-colors">Terms</Link>
            <Link to="/payments-compliance" className="text-muted-foreground hover:text-foreground transition-colors">Payments</Link>
            <Link to="/refunds" className="text-muted-foreground hover:text-foreground transition-colors">Refunds</Link>
          </nav>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline">
              <Download className="h-4 w-4 mr-2" />
              Get App
            </Button>
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
        <div className="container mx-auto px-4">
          <div className="max-w-3xl mx-auto text-center">
            <div className="w-20 h-20 rounded-3xl bg-primary/10 flex items-center justify-center mx-auto mb-8">
              <Smartphone className="h-10 w-10 text-primary" />
            </div>
            <h1 className="text-3xl md:text-5xl font-bold text-foreground mb-6">
              Download the AfriShop App
            </h1>
            <p className="text-lg text-muted-foreground mb-8">
              AfriShop operates through its mobile app to ensure secure payments, identity verification, 
              order tracking, and customer support.
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
          <div className="max-w-3xl mx-auto text-center">
            <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-4">
              Why the App Is Required
            </h2>
            <p className="text-muted-foreground mb-8">
              AfriShop operates through its mobile app to provide a secure, reliable experience. 
              The app enables secure payment processing, identity verification, real-time order 
              tracking, and direct access to customer support.
            </p>
            <div className="bg-background rounded-xl p-6 border border-border/50">
              <p className="text-muted-foreground text-sm">
                <strong>Note:</strong> This website is for informational purposes only. 
                All orders, payments, and account management occur exclusively within the AfriShop mobile application.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-16 bg-background">
        <div className="container mx-auto px-4">
          <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-12 text-center">
            App Features
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
              Getting Started
            </h2>
            <div className="space-y-4">
              <div className="flex items-start gap-4 bg-background rounded-xl p-5 border border-border/50">
                <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold flex-shrink-0">
                  1
                </div>
                <div>
                  <h3 className="font-semibold text-foreground">Download the App</h3>
                  <p className="text-sm text-muted-foreground mt-1">Get AfriShop from Google Play or the App Store</p>
                </div>
              </div>
              <div className="flex items-start gap-4 bg-background rounded-xl p-5 border border-border/50">
                <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold flex-shrink-0">
                  2
                </div>
                <div>
                  <h3 className="font-semibold text-foreground">Create an Account</h3>
                  <p className="text-sm text-muted-foreground mt-1">Sign up with your phone number or email</p>
                </div>
              </div>
              <div className="flex items-start gap-4 bg-background rounded-xl p-5 border border-border/50">
                <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold flex-shrink-0">
                  3
                </div>
                <div>
                  <h3 className="font-semibold text-foreground">Submit a Product Link</h3>
                  <p className="text-sm text-muted-foreground mt-1">Select or paste a product link from a supported retailer</p>
                </div>
              </div>
              <div className="flex items-start gap-4 bg-background rounded-xl p-5 border border-border/50">
                <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold flex-shrink-0">
                  4
                </div>
                <div>
                  <h3 className="font-semibold text-foreground">Confirm and Pay</h3>
                  <p className="text-sm text-muted-foreground mt-1">Review costs and complete payment securely in the app</p>
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
            Ready to Get Started?
          </h2>
          <p className="text-muted-foreground mb-8 max-w-xl mx-auto">
            Download the AfriShop app to begin using our ordering assistance service.
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

export default DownloadPage;
