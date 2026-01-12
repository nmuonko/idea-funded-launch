import { Link } from "react-router-dom";
import { Download, CreditCard, Shield, CheckCircle, Building2, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import afrishopLogo from "@/assets/afrishop-logo.png";

const PaymentsCompliance = () => {
  const complianceItems = [
    "Payment processor requirements",
    "Anti-fraud and AML guidelines",
    "App store policies",
    "Data protection regulations"
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
            <Link to="/payments-compliance" className="font-medium text-primary">Payments</Link>
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
      <section className="py-16 md:py-20 bg-gradient-to-b from-primary/5 to-background">
        <div className="container mx-auto px-4 text-center">
          <CreditCard className="h-16 w-16 text-primary mx-auto mb-6" />
          <h1 className="text-3xl md:text-5xl font-bold text-foreground mb-4">
            Payments & Compliance
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Information about payment processing and regulatory compliance.
          </p>
        </div>
      </section>

      {/* Payment Processing */}
      <section className="py-16 bg-background">
        <div className="container mx-auto px-4">
          <div className="max-w-3xl mx-auto">
            <h2 className="text-2xl font-bold text-foreground mb-6 text-center">
              Payment Processing
            </h2>
            
            <div className="bg-primary/5 rounded-2xl p-6 md:p-8 border border-primary/20 mb-8">
              <div className="flex items-start gap-4">
                <Shield className="h-8 w-8 text-primary flex-shrink-0" />
                <div>
                  <h3 className="font-semibold text-foreground mb-2">All Payments Occur in the App</h3>
                  <p className="text-muted-foreground">
                    All payments are processed exclusively inside the AfriShop mobile application. 
                    This website does not process, initiate, or simulate any payment transactions.
                  </p>
                </div>
              </div>
            </div>

            <p className="text-muted-foreground mb-6">
              Payments are handled by licensed third-party providers including:
            </p>

            <div className="grid md:grid-cols-3 gap-4 mb-8">
              <Card className="border-border/50">
                <CardContent className="p-5 text-center">
                  <CreditCard className="h-8 w-8 text-primary mx-auto mb-3" />
                  <h4 className="font-medium text-foreground text-sm">Card Payments</h4>
                  <p className="text-xs text-muted-foreground mt-1">Licensed card processors</p>
                </CardContent>
              </Card>
              <Card className="border-border/50">
                <CardContent className="p-5 text-center">
                  <svg className="h-8 w-8 text-primary mx-auto mb-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="5" y="2" width="14" height="20" rx="2" ry="2"/>
                    <line x1="12" y1="18" x2="12" y2="18"/>
                  </svg>
                  <h4 className="font-medium text-foreground text-sm">Mobile Money</h4>
                  <p className="text-xs text-muted-foreground mt-1">Regional operators</p>
                </CardContent>
              </Card>
              <Card className="border-border/50">
                <CardContent className="p-5 text-center">
                  <Building2 className="h-8 w-8 text-primary mx-auto mb-3" />
                  <h4 className="font-medium text-foreground text-sm">Bank Partners</h4>
                  <p className="text-xs text-muted-foreground mt-1">Regulated institutions</p>
                </CardContent>
              </Card>
            </div>

            <div className="bg-muted/30 rounded-lg p-4 border border-border/50">
              <p className="text-muted-foreground text-sm text-center">
                AfriShop does not store full card numbers, CVV codes, or mobile money PINs. 
                Payment credentials are handled directly by licensed payment providers.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Compliance */}
      <section className="py-16 bg-muted/20">
        <div className="container mx-auto px-4">
          <div className="max-w-3xl mx-auto">
            <h2 className="text-2xl font-bold text-foreground mb-8 text-center">
              Regulatory Compliance
            </h2>

            <p className="text-muted-foreground text-center mb-8">
              AfriShop maintains compliance with applicable regulations and industry standards:
            </p>

            <div className="space-y-3">
              {complianceItems.map((item, index) => (
                <div key={index} className="flex items-center gap-3 bg-background rounded-lg p-4 border border-border/50">
                  <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0" />
                  <span className="text-foreground">{item}</span>
                </div>
              ))}
            </div>

            <div className="mt-8 bg-muted/30 rounded-xl p-6 border border-border/50 text-center">
              <Building2 className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
              <h3 className="font-semibold text-foreground mb-2">Not a Financial Institution</h3>
              <p className="text-muted-foreground text-sm">
                AfriShop does not operate as a bank, financial institution, or money transmitter. 
                We facilitate transactions through licensed third-party payment providers.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Security */}
      <section className="py-16 bg-background">
        <div className="container mx-auto px-4">
          <div className="max-w-3xl mx-auto text-center">
            <Shield className="h-12 w-12 text-primary mx-auto mb-6" />
            <h2 className="text-2xl font-bold text-foreground mb-4">
              Security Measures
            </h2>
            <p className="text-muted-foreground mb-6">
              We implement industry-standard security practices to protect user data and transactions:
            </p>
            <div className="grid md:grid-cols-2 gap-4 text-left">
              <div className="bg-muted/30 rounded-lg p-4 border border-border/50">
                <h4 className="font-medium text-foreground mb-1">Encrypted Communications</h4>
                <p className="text-sm text-muted-foreground">All data transmitted is protected with encryption</p>
              </div>
              <div className="bg-muted/30 rounded-lg p-4 border border-border/50">
                <h4 className="font-medium text-foreground mb-1">Secure Authentication</h4>
                <p className="text-sm text-muted-foreground">User accounts protected with secure login methods</p>
              </div>
              <div className="bg-muted/30 rounded-lg p-4 border border-border/50">
                <h4 className="font-medium text-foreground mb-1">Fraud Monitoring</h4>
                <p className="text-sm text-muted-foreground">Transactions monitored for suspicious activity</p>
              </div>
              <div className="bg-muted/30 rounded-lg p-4 border border-border/50">
                <h4 className="font-medium text-foreground mb-1">Partner Vetting</h4>
                <p className="text-sm text-muted-foreground">Payment partners verified for compliance</p>
              </div>
            </div>
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

export default PaymentsCompliance;
