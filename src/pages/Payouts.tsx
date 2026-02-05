import { Wallet, ArrowDown, Users, ShieldCheck, FileText, AlertTriangle } from "lucide-react";
import { motion } from "framer-motion";
 import { PublicHeader } from "@/components/public/PublicLayout";
 import { ShopFooter } from "@/components/shop/ShopFooter";

const Payouts = () => {
  const collectionsReasons = [
    { title: "Goods Purchases", desc: "Payment for products purchased from U.S. retailers on behalf of customers" },
    { title: "Shipping & Handling", desc: "International shipping, logistics, customs clearance, and local delivery fees" },
    { title: "Service Fees", desc: "Order facilitation, procurement assistance, and platform service charges" },
  ];

  const payoutReasons = [
    { title: "Supplier/Partner Settlement", desc: "Payments to U.S. retailers and merchant partners for goods purchased" },
    { title: "Shipping & Logistics Providers", desc: "Payments to freight forwarders, carriers, and last-mile delivery partners" },
    { title: "Customer Refunds", desc: "Refunds issued to customers for eligible cancelled orders, failed fulfillment, or disputes" },
    { title: "Operational Settlement", desc: "Settlement to AMERICAN GOODWILL SARL for fulfillment coordination, procurement services, and platform operations" },
  ];

  const beneficiaries = [
    { title: "Suppliers & Merchant Partners", desc: "U.S.-based retailers and wholesalers from whom goods are procured" },
    { title: "Logistics & Shipping Partners", desc: "International freight companies, customs brokers, and local delivery services" },
    { title: "Customers (Refunds Only)", desc: "End customers receiving refunds for eligible cases per our Refund Policy" },
    { title: "AMERICAN GOODWILL SARL", desc: "The operating company, for service fees and operational costs" },
  ];

  return (
    <div className="min-h-screen bg-black text-white">
      <PublicHeader />

      {/* Hero */}
      <section className="relative pt-32 pb-20 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-900/20 via-black to-cyan-900/20" />
        <div className="absolute top-1/3 left-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl" />
        
        <div className="container mx-auto px-4 relative z-10">
          <motion.div 
            className="max-w-3xl mx-auto text-center"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-blue-500/20 to-cyan-500/20 flex items-center justify-center mx-auto mb-8 border border-blue-500/20">
              <Wallet className="h-10 w-10 text-blue-400" />
            </div>
            <h1 className="text-4xl md:text-6xl font-bold mb-6">
              Payouts & <span className="bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">Beneficiaries</span>
            </h1>
            <p className="text-lg text-white/60">
              Transparency in how customer payments are collected and distributed.
            </p>
          </motion.div>
        </div>
      </section>

      {/* What Customers Pay For (Collections) */}
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
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-green-500/20 to-emerald-500/20 flex items-center justify-center">
                  <ArrowDown className="h-6 w-6 text-green-400" />
                </div>
                <h2 className="text-xl font-bold">What Customers Pay For (Collections)</h2>
              </div>
              <p className="text-white/70 mb-6">
                When customers place orders through AfriShop, payments are collected for the following purposes:
              </p>
              <div className="space-y-4">
                {collectionsReasons.map((item, i) => (
                  <div key={i} className="p-4 bg-white/5 rounded-2xl border border-white/10">
                    <h3 className="font-semibold mb-1">{item.title}</h3>
                    <p className="text-white/60 text-sm">{item.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Why Payouts Occur */}
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
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500/20 to-cyan-500/20 flex items-center justify-center">
                  <Wallet className="h-6 w-6 text-blue-400" />
                </div>
                <h2 className="text-xl font-bold">Why Payouts Occur</h2>
              </div>
              <p className="text-white/70 mb-6">
                Funds collected from customers are disbursed to fulfill orders and operate the platform:
              </p>
              <div className="space-y-4">
                {payoutReasons.map((item, i) => (
                  <div key={i} className="p-4 bg-white/5 rounded-2xl border border-white/10">
                    <h3 className="font-semibold mb-1">{item.title}</h3>
                    <p className="text-white/60 text-sm">{item.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Who Are the Beneficiaries */}
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
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-purple-500/20 to-violet-500/20 flex items-center justify-center">
                  <Users className="h-6 w-6 text-purple-400" />
                </div>
                <h2 className="text-xl font-bold">Who Are the Beneficiaries</h2>
              </div>
              <p className="text-white/70 mb-6">
                Payouts are made exclusively to the following categories of beneficiaries:
              </p>
              <div className="space-y-4">
                {beneficiaries.map((item, i) => (
                  <div key={i} className="flex items-start gap-4 p-4 bg-white/5 rounded-2xl border border-white/10">
                    <span className="w-8 h-8 rounded-full bg-purple-500/20 flex items-center justify-center text-purple-400 font-bold text-sm flex-shrink-0">
                      {i + 1}
                    </span>
                    <div>
                      <h3 className="font-semibold mb-1">{item.title}</h3>
                      <p className="text-white/60 text-sm">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Traceability Statement */}
      <section className="py-16">
        <div className="container mx-auto px-4">
          <motion.div 
            className="max-w-3xl mx-auto"
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <div className="bg-gradient-to-br from-green-500/10 to-emerald-500/5 rounded-3xl p-8 border border-green-500/20">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-green-500/20 to-emerald-500/20 flex items-center justify-center flex-shrink-0">
                  <FileText className="h-6 w-6 text-green-400" />
                </div>
                <div>
                  <h2 className="text-xl font-bold mb-4">Traceability & Record-Keeping</h2>
                  <p className="text-white/70 leading-relaxed mb-4">
                    Every payout made by AfriShop is linked to a specific order, invoice, or transaction record. 
                    We maintain comprehensive records of all collections and disbursements, including:
                  </p>
                  <ul className="space-y-2">
                    <li className="flex items-start gap-3">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-400 mt-2.5 flex-shrink-0" />
                      <span className="text-white/70">Order reference numbers and associated payment details</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-400 mt-2.5 flex-shrink-0" />
                      <span className="text-white/70">Beneficiary identification for each payout</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-400 mt-2.5 flex-shrink-0" />
                      <span className="text-white/70">Transaction timestamps and amounts</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-400 mt-2.5 flex-shrink-0" />
                      <span className="text-white/70">Records retained in accordance with applicable regulations</span>
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Compliance Note */}
      <section className="py-16">
        <div className="container mx-auto px-4">
          <motion.div 
            className="max-w-3xl mx-auto"
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <div className="bg-gradient-to-br from-amber-500/10 to-orange-500/5 rounded-3xl p-8 border border-amber-500/20">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-500/20 to-orange-500/20 flex items-center justify-center flex-shrink-0">
                  <ShieldCheck className="h-6 w-6 text-amber-400" />
                </div>
                <div>
                  <h2 className="text-xl font-bold mb-4">Compliance & Acceptable Use</h2>
                  <p className="text-white/70 leading-relaxed mb-4">
                    AfriShop is committed to compliance with applicable laws and payment provider policies. 
                    We do not facilitate the purchase, sale, or shipment of:
                  </p>
                  <ul className="space-y-2 mb-4">
                    <li className="flex items-start gap-3">
                      <AlertTriangle className="h-4 w-4 text-amber-400 mt-1 flex-shrink-0" />
                      <span className="text-white/70">Items prohibited by U.S. or destination country laws</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <AlertTriangle className="h-4 w-4 text-amber-400 mt-1 flex-shrink-0" />
                      <span className="text-white/70">Hazardous materials or dangerous goods</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <AlertTriangle className="h-4 w-4 text-amber-400 mt-1 flex-shrink-0" />
                      <span className="text-white/70">Counterfeit or infringing products</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <AlertTriangle className="h-4 w-4 text-amber-400 mt-1 flex-shrink-0" />
                      <span className="text-white/70">Items restricted by shipping carriers or payment providers</span>
                    </li>
                  </ul>
                  <p className="text-white/60 text-sm">
                    For a complete list, please refer to our <a href="/terms" className="text-amber-400 hover:underline">Terms of Service</a>.
                  </p>
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

export default Payouts;
