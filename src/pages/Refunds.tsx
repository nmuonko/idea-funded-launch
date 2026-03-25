import { RotateCcw, CheckCircle, AlertCircle, MessageCircle, Mail, Clock, Building2, FileText } from "lucide-react";
import { motion } from "framer-motion";
import { PublicHeader } from "@/components/public/PublicLayout";
import { ShopFooter } from "@/components/shop/ShopFooter";
import { RefundRequestForm } from "@/components/shop/RefundRequestForm";
import { useLanguage } from "@/contexts/LanguageContext";

const Refunds = () => {
  const { language } = useLanguage();
  const eligibleReasons = [
    "Failed fulfillment due to retailer or logistics issues",
    "Verified order cancellation before purchase completion",
    "Payment processing errors or duplicate charges",
    "Items significantly different from description",
    "Damaged goods (with photographic evidence)"
  ];

  const ineligibleReasons = [
    "Change of mind after order confirmation",
    "Items already shipped or delivered without defects",
    "Customs seizure due to prohibited items",
    "Incorrect information provided by user",
    "Normal shipping delays within estimated timeframes"
  ];

  const steps = [
    { num: "1", title: "Submit Request", desc: "Contact support through the AfriShop app or email with your order reference and refund reason.", time: "Immediate" },
    { num: "2", title: "Review", desc: "Our team reviews your request and may ask for additional information or evidence.", time: "1-3 business days" },
    { num: "3", title: "Decision", desc: "We notify you of the outcome. If approved, we confirm the refund amount and method.", time: "2-5 business days" },
    { num: "4", title: "Processing", desc: "Approved refunds are processed to the original payment method.", time: "5-14 business days" }
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
              Refund <span className="bg-gradient-to-r from-rose-400 to-pink-400 bg-clip-text text-transparent">Policy</span>
            </h1>
            <p className="text-lg text-white/60">
              Information about refund eligibility, timelines, and dispute resolution.
            </p>
          </motion.div>
        </div>
      </section>

      {/* Overview */}
      <section className="py-16">
        <div className="container mx-auto px-4">
          <motion.div 
            className="max-w-3xl mx-auto"
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <div className="bg-gradient-to-br from-white/5 to-transparent rounded-3xl p-8 border border-white/10">
              <h2 className="text-xl font-bold mb-4">Refund Policy Overview</h2>
              <div className="space-y-4 text-white/70">
                <p>
                  AfriShop (operated by <strong className="text-white/90">AMERICAN GOODWILL SARL</strong>) is 
                  committed to fair and transparent refund practices. This policy outlines when refunds 
                  are available and how they are processed.
                </p>
                <p>
                  Because AfriShop facilitates purchases from third-party retailers, refund eligibility 
                  depends on the specific circumstances of each order, including retailer policies and 
                  shipment status.
                </p>
              </div>
            </div>
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
            circumstances of each case. Each request is evaluated individually.
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
            Refund Process & Timelines
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
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <h3 className="font-semibold">{step.title}</h3>
                    <span className="text-xs text-white/40 flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {step.time}
                    </span>
                  </div>
                  <p className="text-white/60 text-sm">{step.desc}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Exceptions */}
      <section className="py-16">
        <div className="container mx-auto px-4">
          <motion.div 
            className="max-w-3xl mx-auto"
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <div className="bg-gradient-to-br from-white/5 to-transparent rounded-3xl p-8 border border-white/10">
              <div className="flex items-center gap-4 mb-6">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-rose-500/20 to-pink-500/20 flex items-center justify-center">
                  <FileText className="h-6 w-6 text-rose-400" />
                </div>
                <h2 className="text-xl font-bold">Important Notes</h2>
              </div>
              <ul className="space-y-4 text-white/70">
                <li className="flex items-start gap-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-400 mt-2.5 flex-shrink-0" />
                  <span>Refunds are processed to the original payment method. Bank transfer and mobile money refunds may take additional time depending on your provider.</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-400 mt-2.5 flex-shrink-0" />
                  <span>Service fees may be non-refundable in cases where work has already been performed (e.g., goods purchased from retailers).</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-400 mt-2.5 flex-shrink-0" />
                  <span>Partial refunds may be issued in some cases, reflecting the portion of the order that could not be fulfilled.</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-400 mt-2.5 flex-shrink-0" />
                  <span>For items requiring return to retailers, additional shipping costs may apply.</span>
                </li>
              </ul>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Submit Refund Request */}
      <section className="py-16">
        <div className="container mx-auto px-4">
          <motion.div 
            className="max-w-3xl mx-auto"
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <div className="bg-gradient-to-br from-white/5 to-transparent rounded-3xl p-8 border border-white/10">
              <h2 className="text-xl font-bold mb-6">
                {language === 'fr' ? 'Soumettre une demande de remboursement' : 'Submit a Refund Request'}
              </h2>
              <RefundRequestForm />
            </div>
          </motion.div>
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
                    fairly and efficiently. Chargebacks initiated without prior contact may delay resolution.
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-gradient-to-br from-white/5 to-transparent rounded-3xl p-8 border border-white/10">
              <h3 className="text-lg font-bold mb-6">Contact Information</h3>
              <div className="grid md:grid-cols-2 gap-4">
                <div className="flex items-center gap-4 p-4 bg-white/5 rounded-2xl">
                  <div className="w-12 h-12 rounded-xl bg-rose-500/20 flex items-center justify-center">
                    <Mail className="h-6 w-6 text-rose-400" />
                  </div>
                  <div>
                    <p className="text-sm text-white/50">Email Support</p>
                    <a href="mailto:support@afrishop-usa.com" className="text-white hover:text-rose-400 transition-colors">
                      support@afrishop-usa.com
                    </a>
                  </div>
                </div>
                <div className="flex items-center gap-4 p-4 bg-white/5 rounded-2xl">
                  <div className="w-12 h-12 rounded-xl bg-rose-500/20 flex items-center justify-center">
                    <Building2 className="h-6 w-6 text-rose-400" />
                  </div>
                  <div>
                    <p className="text-sm text-white/50">Company</p>
                    <span className="text-white">AMERICAN GOODWILL SARL</span>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

       <ShopFooter />
    </div>
  );
};

export default Refunds;
