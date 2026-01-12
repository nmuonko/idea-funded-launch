import { Link } from "react-router-dom";
import { Download, RotateCcw, CheckCircle, AlertCircle, MessageCircle, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const Refunds = () => {
  const eligibilityReasons = [
    "Failed fulfillment due to retailer or logistics issues",
    "Verified order cancellation before purchase completion",
    "Payment processing errors",
    "Duplicate charges"
  ];

  const ineligibleReasons = [
    "Change of mind after order confirmation",
    "Items already shipped or delivered",
    "Customs seizure due to prohibited items",
    "Incorrect information provided by user"
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
            <Link to="/how-it-works" className="text-muted-foreground hover:text-foreground transition-colors">How It Works</Link>
            <Link to="/privacy" className="text-muted-foreground hover:text-foreground transition-colors">Privacy</Link>
            <Link to="/terms" className="text-muted-foreground hover:text-foreground transition-colors">Terms</Link>
            <Link to="/payments-compliance" className="text-muted-foreground hover:text-foreground transition-colors">Payments</Link>
            <Link to="/refunds" className="font-medium text-primary">Refunds</Link>
          </nav>
          <Link to="/download">
            <Button size="sm">
              <Download className="h-4 w-4 mr-2" />
              Get App
            </Button>
          </Link>
        </div>
      </header>

      {/* Hero Section */}
      <section className="py-16 md:py-20 bg-gradient-to-b from-primary/5 to-background">
        <div className="container mx-auto px-4 text-center">
          <RotateCcw className="h-16 w-16 text-primary mx-auto mb-6" />
          <h1 className="text-3xl md:text-5xl font-bold text-foreground mb-4">
            Refunds & Disputes
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Information about refund eligibility and dispute resolution.
          </p>
        </div>
      </section>

      {/* Refund Eligibility */}
      <section className="py-16 bg-background">
        <div className="container mx-auto px-4">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-2xl font-bold text-foreground mb-8 text-center">
              Refund Eligibility
            </h2>

            <div className="grid md:grid-cols-2 gap-6">
              {/* Eligible */}
              <Card className="border-green-200 dark:border-green-900/50 bg-green-50/50 dark:bg-green-950/20">
                <CardContent className="p-6">
                  <div className="flex items-center gap-3 mb-4">
                    <CheckCircle className="h-6 w-6 text-green-600" />
                    <h3 className="font-semibold text-foreground">May Be Eligible</h3>
                  </div>
                  <ul className="space-y-3">
                    {eligibilityReasons.map((reason, index) => (
                      <li key={index} className="flex items-start gap-2 text-sm text-muted-foreground">
                        <span className="text-green-600 mt-1">•</span>
                        <span>{reason}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>

              {/* Ineligible */}
              <Card className="border-amber-200 dark:border-amber-900/50 bg-amber-50/50 dark:bg-amber-950/20">
                <CardContent className="p-6">
                  <div className="flex items-center gap-3 mb-4">
                    <AlertCircle className="h-6 w-6 text-amber-600" />
                    <h3 className="font-semibold text-foreground">Generally Not Eligible</h3>
                  </div>
                  <ul className="space-y-3">
                    {ineligibleReasons.map((reason, index) => (
                      <li key={index} className="flex items-start gap-2 text-sm text-muted-foreground">
                        <span className="text-amber-600 mt-1">•</span>
                        <span>{reason}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </div>

            <div className="mt-8 bg-muted/30 rounded-xl p-6 border border-border/50">
              <p className="text-muted-foreground text-center">
                Refund eligibility depends on retailer policies, shipment status, and the specific 
                circumstances of each case. Each request is evaluated individually.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Refund Process */}
      <section className="py-16 bg-muted/20">
        <div className="container mx-auto px-4">
          <div className="max-w-3xl mx-auto">
            <h2 className="text-2xl font-bold text-foreground mb-8 text-center">
              Refund Process
            </h2>

            <div className="space-y-4">
              <div className="flex items-start gap-4 bg-background rounded-xl p-5 border border-border/50">
                <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold flex-shrink-0">
                  1
                </div>
                <div>
                  <h3 className="font-semibold text-foreground">Submit Request</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    Contact support through the AfriShop app with your order details and refund reason.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4 bg-background rounded-xl p-5 border border-border/50">
                <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold flex-shrink-0">
                  2
                </div>
                <div>
                  <h3 className="font-semibold text-foreground">Review</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    Our team reviews your request and may ask for additional information.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4 bg-background rounded-xl p-5 border border-border/50">
                <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold flex-shrink-0">
                  3
                </div>
                <div>
                  <h3 className="font-semibold text-foreground">Resolution</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    If approved, refunds are processed to the original payment method. Processing times vary by payment provider.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Dispute Resolution */}
      <section className="py-16 bg-background">
        <div className="container mx-auto px-4">
          <div className="max-w-3xl mx-auto">
            <h2 className="text-2xl font-bold text-foreground mb-6 text-center">
              Dispute Resolution
            </h2>

            <div className="bg-primary/5 rounded-2xl p-6 md:p-8 border border-primary/20 mb-8">
              <div className="flex items-start gap-4">
                <MessageCircle className="h-8 w-8 text-primary flex-shrink-0" />
                <div>
                  <h3 className="font-semibold text-foreground mb-2">Contact Support First</h3>
                  <p className="text-muted-foreground">
                    We encourage users to contact AfriShop support for dispute resolution before 
                    initiating chargebacks with payment providers. Our team works to resolve issues 
                    fairly and efficiently.
                  </p>
                </div>
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div className="bg-muted/30 rounded-lg p-5 border border-border/50">
                <h4 className="font-medium text-foreground mb-2">In-App Support</h4>
                <p className="text-sm text-muted-foreground">
                  Access customer support directly through the AfriShop mobile app for fastest response.
                </p>
              </div>
              <div className="bg-muted/30 rounded-lg p-5 border border-border/50">
                <h4 className="font-medium text-foreground mb-2">Email Support</h4>
                <p className="text-sm text-muted-foreground">
                  Contact our support team via email for detailed inquiries.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Contact */}
      <section className="py-16 bg-muted/20">
        <div className="container mx-auto px-4">
          <div className="max-w-xl mx-auto text-center">
            <h2 className="text-2xl font-bold text-foreground mb-6">
              Need Help?
            </h2>
            <p className="text-muted-foreground mb-8">
              For refund requests or disputes, contact our support team.
            </p>
            <div className="bg-background rounded-xl p-6 border border-border/50">
              <div className="flex items-center justify-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Mail className="h-5 w-5 text-primary" />
                </div>
                <div className="text-left">
                  <p className="text-sm text-muted-foreground">Email</p>
                  <a href="mailto:support@afrishop-usa.com" className="text-foreground hover:text-primary transition-colors">
                    support@afrishop-usa.com
                  </a>
                </div>
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
              <Link to="/how-it-works" className="text-muted-foreground hover:text-foreground transition-colors">How It Works</Link>
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

export default Refunds;
