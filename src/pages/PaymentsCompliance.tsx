import { CreditCard, Shield, CheckCircle, Building2, Smartphone, Lock } from "lucide-react";
import { motion } from "framer-motion";
import { PublicHeader, PublicFooter } from "@/components/public/PublicLayout";

const PaymentsCompliance = () => {
  const complianceItems = [
    "Payment processor requirements",
    "Anti-fraud and AML guidelines",
    "App store policies",
    "Data protection regulations"
  ];

  const securityFeatures = [
    { title: "Encrypted Communications", desc: "All data transmitted is protected with encryption" },
    { title: "Secure Authentication", desc: "User accounts protected with secure login methods" },
    { title: "Fraud Monitoring", desc: "Transactions monitored for suspicious activity" },
    { title: "Partner Vetting", desc: "Payment partners verified for compliance" }
  ];

  return (
    <div className="min-h-screen bg-black text-white">
      <PublicHeader />

      {/* Hero */}
      <section className="relative pt-32 pb-20 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-orange-900/20 via-black to-amber-900/20" />
        <div className="absolute top-1/3 right-1/3 w-96 h-96 bg-orange-500/10 rounded-full blur-3xl" />
        
        <div className="container mx-auto px-4 relative z-10">
          <motion.div 
            className="max-w-3xl mx-auto text-center"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-orange-500/20 to-amber-500/20 flex items-center justify-center mx-auto mb-8 border border-orange-500/20">
              <CreditCard className="h-10 w-10 text-orange-400" />
            </div>
            <h1 className="text-4xl md:text-6xl font-bold mb-6">
              Payments & <span className="bg-gradient-to-r from-orange-400 to-amber-400 bg-clip-text text-transparent">Compliance</span>
            </h1>
            <p className="text-lg text-white/60">
              Information about payment processing and regulatory compliance.
            </p>
          </motion.div>
        </div>
      </section>

      {/* Payment Processing */}
      <section className="py-16">
        <div className="container mx-auto px-4">
          <motion.div 
            className="max-w-3xl mx-auto"
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <div className="bg-gradient-to-br from-orange-500/10 to-amber-500/5 rounded-3xl p-8 border border-orange-500/20 mb-8">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-2xl bg-orange-500/20 flex items-center justify-center flex-shrink-0">
                  <Smartphone className="h-6 w-6 text-orange-400" />
                </div>
                <div>
                  <h3 className="text-xl font-bold mb-2">All Payments Occur in the App</h3>
                  <p className="text-white/70">
                    All payments are processed exclusively inside the AfriShop mobile application. 
                    This website does not process, initiate, or simulate any payment transactions.
                  </p>
                </div>
              </div>
            </div>

            <h3 className="text-lg font-semibold mb-6 text-white/80">Payments handled by licensed providers:</h3>
            
            <div className="grid md:grid-cols-3 gap-4 mb-8">
              {[
                { icon: CreditCard, title: "Card Payments", desc: "Licensed card processors" },
                { icon: Smartphone, title: "Mobile Money", desc: "Regional operators" },
                { icon: Building2, title: "Bank Partners", desc: "Regulated institutions" }
              ].map((item, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.1 }}
                  className="bg-white/5 rounded-2xl p-6 border border-white/10 text-center"
                >
                  <item.icon className="h-8 w-8 text-orange-400 mx-auto mb-3" />
                  <h4 className="font-semibold mb-1">{item.title}</h4>
                  <p className="text-sm text-white/50">{item.desc}</p>
                </motion.div>
              ))}
            </div>

            <div className="p-4 bg-white/5 rounded-2xl border border-white/10 text-center">
              <p className="text-white/60 text-sm">
                AfriShop does not store full card numbers, CVV codes, or mobile money PINs. 
                Payment credentials are handled directly by licensed payment providers.
              </p>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Compliance */}
      <section className="py-16">
        <div className="container mx-auto px-4">
          <motion.div 
            className="max-w-3xl mx-auto"
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <h2 className="text-2xl font-bold mb-8 text-center">Regulatory Compliance</h2>
            
            <div className="space-y-3 mb-8">
              {complianceItems.map((item, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.1 }}
                  className="flex items-center gap-4 p-4 bg-white/5 rounded-xl border border-white/10"
                >
                  <CheckCircle className="h-5 w-5 text-green-400 flex-shrink-0" />
                  <span className="text-white/80">{item}</span>
                </motion.div>
              ))}
            </div>

            <div className="bg-gradient-to-br from-white/5 to-transparent rounded-3xl p-8 border border-white/10 text-center">
              <Building2 className="h-12 w-12 text-white/30 mx-auto mb-4" />
              <h3 className="text-lg font-bold mb-2">Not a Financial Institution</h3>
              <p className="text-white/60 text-sm">
                AfriShop does not operate as a bank, financial institution, or money transmitter. 
                We facilitate transactions through licensed third-party payment providers.
              </p>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Security */}
      <section className="py-16">
        <div className="container mx-auto px-4">
          <motion.div 
            className="max-w-3xl mx-auto"
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <div className="text-center mb-10">
              <Lock className="h-12 w-12 text-orange-400 mx-auto mb-4" />
              <h2 className="text-2xl font-bold">Security Measures</h2>
            </div>
            
            <div className="grid md:grid-cols-2 gap-4">
              {securityFeatures.map((item, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.1 }}
                  className="bg-white/5 rounded-2xl p-6 border border-white/10"
                >
                  <h4 className="font-semibold mb-2">{item.title}</h4>
                  <p className="text-sm text-white/60">{item.desc}</p>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
};

export default PaymentsCompliance;
