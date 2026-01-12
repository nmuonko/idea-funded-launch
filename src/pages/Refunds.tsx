import { RotateCcw, CheckCircle, AlertCircle, MessageCircle, Mail } from "lucide-react";
import { motion } from "framer-motion";
import { PublicHeader, PublicFooter } from "@/components/public/PublicLayout";

const Refunds = () => {
  const eligibleReasons = [
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

  const steps = [
    { num: "1", title: "Submit Request", desc: "Contact support through the AfriShop app with your order details and refund reason." },
    { num: "2", title: "Review", desc: "Our team reviews your request and may ask for additional information." },
    { num: "3", title: "Resolution", desc: "If approved, refunds are processed to the original payment method." }
  ];

  return (
    <div className="min-h-screen bg-black text-white">
      <PublicHeader />

      {/* Hero */}
      <section className="relative pt-32 pb-20 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-rose-900/20 via-black to-pink-900/20" />
        <div className="absolute top-1/3 left-1/3 w-96 h-96 bg-rose-500/10 rounded-full blur-3xl" />
        
        <div className="container mx-auto px-4 relative z-10">
          <motion.div 
            className="max-w-3xl mx-auto text-center"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-rose-500/20 to-pink-500/20 flex items-center justify-center mx-auto mb-8 border border-rose-500/20">
              <RotateCcw className="h-10 w-10 text-rose-400" />
            </div>
            <h1 className="text-4xl md:text-6xl font-bold mb-6">
              Refunds & <span className="bg-gradient-to-r from-rose-400 to-pink-400 bg-clip-text text-transparent">Disputes</span>
            </h1>
            <p className="text-lg text-white/60">
              Information about refund eligibility and dispute resolution.
            </p>
          </motion.div>
        </div>
      </section>

      {/* Eligibility */}
      <section className="py-16">
        <div className="container mx-auto px-4">
          <motion.h2 
            className="text-2xl font-bold mb-10 text-center"
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
          >
            Refund Eligibility
          </motion.h2>
          
          <div className="max-w-4xl mx-auto grid md:grid-cols-2 gap-6">
            <motion.div
              initial={{ opacity: 0, x: -30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              className="bg-gradient-to-br from-green-500/10 to-emerald-500/5 rounded-3xl p-8 border border-green-500/20"
            >
              <div className="flex items-center gap-3 mb-6">
                <CheckCircle className="h-6 w-6 text-green-400" />
                <h3 className="text-lg font-bold">May Be Eligible</h3>
              </div>
              <ul className="space-y-3">
                {eligibleReasons.map((item, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-400 mt-2.5 flex-shrink-0" />
                    <span className="text-white/70 text-sm">{item}</span>
                  </li>
                ))}
              </ul>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: 30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              className="bg-gradient-to-br from-amber-500/10 to-orange-500/5 rounded-3xl p-8 border border-amber-500/20"
            >
              <div className="flex items-center gap-3 mb-6">
                <AlertCircle className="h-6 w-6 text-amber-400" />
                <h3 className="text-lg font-bold">Generally Not Eligible</h3>
              </div>
              <ul className="space-y-3">
                {ineligibleReasons.map((item, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 mt-2.5 flex-shrink-0" />
                    <span className="text-white/70 text-sm">{item}</span>
                  </li>
                ))}
              </ul>
            </motion.div>
          </div>

          <motion.p 
            className="text-center text-white/50 text-sm mt-8 max-w-2xl mx-auto"
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
          >
            Refund eligibility depends on retailer policies, shipment status, and the specific 
            circumstances of each case.
          </motion.p>
        </div>
      </section>

      {/* Process */}
      <section className="py-16">
        <div className="container mx-auto px-4">
          <motion.h2 
            className="text-2xl font-bold mb-10 text-center"
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
          >
            Refund Process
          </motion.h2>
          
          <div className="max-w-3xl mx-auto space-y-4">
            {steps.map((step, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className="flex items-start gap-6 p-6 bg-white/5 rounded-2xl border border-white/10"
              >
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-rose-500 to-pink-500 flex items-center justify-center font-bold text-lg flex-shrink-0">
                  {step.num}
                </div>
                <div>
                  <h3 className="font-semibold mb-1">{step.title}</h3>
                  <p className="text-white/60 text-sm">{step.desc}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Dispute Resolution */}
      <section className="py-16">
        <div className="container mx-auto px-4">
          <motion.div 
            className="max-w-3xl mx-auto"
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <div className="bg-gradient-to-br from-rose-500/10 to-pink-500/5 rounded-3xl p-8 border border-rose-500/20 mb-8">
              <div className="flex items-start gap-4">
                <MessageCircle className="h-8 w-8 text-rose-400 flex-shrink-0" />
                <div>
                  <h3 className="text-xl font-bold mb-2">Contact Support First</h3>
                  <p className="text-white/70">
                    We encourage users to contact AfriShop support for dispute resolution before 
                    initiating chargebacks with payment providers. Our team works to resolve issues 
                    fairly and efficiently.
                  </p>
                </div>
              </div>
            </div>

            <div className="text-center">
              <h3 className="text-lg font-bold mb-6">Need Help?</h3>
              <div className="inline-flex items-center gap-4 p-5 bg-white/5 rounded-2xl border border-white/10">
                <div className="w-12 h-12 rounded-xl bg-rose-500/20 flex items-center justify-center">
                  <Mail className="h-6 w-6 text-rose-400" />
                </div>
                <div className="text-left">
                  <p className="text-sm text-white/50">Email Support</p>
                  <a href="mailto:support@afrishop-usa.com" className="text-white hover:text-rose-400 transition-colors">
                    support@afrishop-usa.com
                  </a>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
};

export default Refunds;
