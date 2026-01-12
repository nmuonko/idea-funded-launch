import { Link } from "react-router-dom";
import { Download, Shield, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";

const Privacy = () => {
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
            <Link to="/privacy" className="font-medium text-primary">Privacy</Link>
            <Link to="/terms" className="text-muted-foreground hover:text-foreground transition-colors">Terms</Link>
            <Link to="/payments-compliance" className="text-muted-foreground hover:text-foreground transition-colors">Payments</Link>
            <Link to="/refunds" className="text-muted-foreground hover:text-foreground transition-colors">Refunds</Link>
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
          <Shield className="h-16 w-16 text-primary mx-auto mb-6" />
          <h1 className="text-3xl md:text-5xl font-bold text-foreground mb-4">
            Privacy Notice
          </h1>
          <p className="text-muted-foreground">
            Last updated: {new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
          </p>
        </div>
      </section>

      {/* Content */}
      <section className="py-12 md:py-16">
        <div className="container mx-auto px-4">
          <div className="max-w-3xl mx-auto">
            
            {/* Introduction */}
            <div className="mb-12">
              <h2 className="text-xl font-bold text-foreground mb-4">Introduction</h2>
              <p className="text-muted-foreground leading-relaxed">
                This Privacy Notice explains how AfriShop collects, uses, and protects personal information. 
                We are committed to safeguarding your privacy and ensuring transparency in our data practices.
              </p>
            </div>

            {/* Information Collected */}
            <div className="mb-12">
              <h2 className="text-xl font-bold text-foreground mb-4">Information Collected</h2>
              <p className="text-muted-foreground mb-4">
                We may collect the following types of information:
              </p>
              <ul className="space-y-3 text-muted-foreground">
                <li className="flex items-start gap-3">
                  <span className="text-primary mt-1">•</span>
                  <span><strong>Account Details:</strong> Name, phone number, email address</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="text-primary mt-1">•</span>
                  <span><strong>Order and Delivery Information:</strong> Shipping addresses, order history</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="text-primary mt-1">•</span>
                  <span><strong>Communication Records:</strong> Support inquiries and correspondence</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="text-primary mt-1">•</span>
                  <span><strong>Technical and Device Information:</strong> Device type, operating system, app version</span>
                </li>
              </ul>
            </div>

            {/* Payment Information */}
            <div className="mb-12">
              <h2 className="text-xl font-bold text-foreground mb-4">Payment Information</h2>
              <p className="text-muted-foreground leading-relaxed">
                Payments are processed by licensed third-party payment providers. AfriShop does not store 
                full card numbers, CVV codes, or mobile money PINs. Payment processing is handled securely 
                by our payment partners in compliance with applicable regulations.
              </p>
            </div>

            {/* Use of Data */}
            <div className="mb-12">
              <h2 className="text-xl font-bold text-foreground mb-4">Use of Data</h2>
              <p className="text-muted-foreground mb-4">
                Your data is used for:
              </p>
              <ul className="space-y-3 text-muted-foreground">
                <li className="flex items-start gap-3">
                  <span className="text-primary mt-1">•</span>
                  <span>Processing and fulfilling orders</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="text-primary mt-1">•</span>
                  <span>Providing customer support</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="text-primary mt-1">•</span>
                  <span>Meeting legal and regulatory obligations</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="text-primary mt-1">•</span>
                  <span>Improving service reliability</span>
                </li>
              </ul>
            </div>

            {/* Data Sharing */}
            <div className="mb-12">
              <h2 className="text-xl font-bold text-foreground mb-4">Data Sharing</h2>
              <p className="text-muted-foreground mb-4">
                Your data may be shared only with:
              </p>
              <ul className="space-y-3 text-muted-foreground">
                <li className="flex items-start gap-3">
                  <span className="text-primary mt-1">•</span>
                  <span><strong>Payment Processors:</strong> To process transactions securely</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="text-primary mt-1">•</span>
                  <span><strong>Shipping and Logistics Partners:</strong> To coordinate delivery</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="text-primary mt-1">•</span>
                  <span><strong>Regulatory Authorities:</strong> Where required by law</span>
                </li>
              </ul>
              <p className="text-muted-foreground mt-4">
                We do not sell personal information to third parties.
              </p>
            </div>

            {/* User Rights */}
            <div className="mb-12">
              <h2 className="text-xl font-bold text-foreground mb-4">User Rights</h2>
              <p className="text-muted-foreground leading-relaxed">
                Users may request access, correction, or deletion of their personal data. To exercise 
                these rights, please contact us using the information provided below.
              </p>
            </div>

            {/* Contact */}
            <div className="mb-8">
              <h2 className="text-xl font-bold text-foreground mb-4">Contact</h2>
              <div className="bg-muted/30 rounded-xl p-6 border border-border/50">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Mail className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Email</p>
                    <a href="mailto:privacy@afrishop-usa.com" className="text-foreground hover:text-primary transition-colors">
                      privacy@afrishop-usa.com
                    </a>
                  </div>
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

export default Privacy;
