import { Trash2, Mail, CheckCircle, Clock, AlertCircle, ShieldCheck } from "lucide-react";
import { motion } from "framer-motion";
import { PublicHeader, PublicFooter } from "@/components/public/PublicLayout";

const fadeInUp = {
  initial: { opacity: 0, y: 30 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.6 }
};

const DeleteAccount = () => {
  const deletionSteps = [
    { step: 1, text: "Send an email to nkadimisha@afrishop-usa.com" },
    { step: 2, text: 'Use the subject line: Account Deletion Request' },
    { step: 3, text: "Include the email address associated with your AfriShop account" },
  ];

  const deletedData = [
    "Account information (name, email address, phone number)",
    "Saved shipping and delivery addresses",
    "Order history linked to the account",
    "Customer support and communication records",
  ];

  const retainedData = [
    "Transaction records",
    "Payment references processed by third-party payment providers",
  ];

  return (
    <div className="min-h-screen bg-black text-white">
      <PublicHeader />

      {/* Hero */}
      <section className="relative pt-32 pb-20 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-red-900/20 via-black to-orange-900/20" />
        <div className="absolute top-1/3 right-1/4 w-96 h-96 bg-red-500/10 rounded-full blur-3xl" />
        
        <div className="container mx-auto px-4 relative z-10">
          <motion.div 
            className="max-w-3xl mx-auto text-center"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-red-500/20 to-orange-500/20 flex items-center justify-center mx-auto mb-8 border border-red-500/20">
              <Trash2 className="h-10 w-10 text-red-400" />
            </div>
            <h1 className="text-4xl md:text-6xl font-bold mb-6">
              Account & Data <span className="bg-gradient-to-r from-red-400 to-orange-400 bg-clip-text text-transparent">Deletion</span>
            </h1>
            <p className="text-white/60 text-lg">
              AfriShop
            </p>
          </motion.div>
        </div>
      </section>

      {/* Introduction */}
      <section className="py-16">
        <div className="container mx-auto px-4">
          <motion.div 
            className="max-w-3xl mx-auto"
            initial="initial"
            whileInView="animate"
            viewport={{ once: true }}
            variants={fadeInUp}
          >
            <div className="bg-gradient-to-br from-white/5 to-transparent backdrop-blur-xl rounded-3xl p-8 border border-white/10">
              <p className="text-white/70 leading-relaxed text-lg">
                AfriShop respects user privacy and provides a clear process for requesting the deletion of an account and associated personal data.
              </p>
            </div>
          </motion.div>
        </div>
      </section>

      {/* How to Request */}
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
                  <Mail className="h-6 w-6 text-green-400" />
                </div>
                <h2 className="text-xl font-bold">How to Request Account Deletion</h2>
              </div>
              
              <p className="text-white/70 mb-6">
                To request deletion of your AfriShop account, please follow these steps:
              </p>
              
              <div className="space-y-4">
                {deletionSteps.map((item) => (
                  <div key={item.step} className="flex items-start gap-4">
                    <div className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center flex-shrink-0">
                      <span className="text-green-400 font-bold text-sm">{item.step}</span>
                    </div>
                    <p className="text-white/70 pt-1">{item.text}</p>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Data Deleted */}
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
                  <CheckCircle className="h-6 w-6 text-green-400" />
                </div>
                <h2 className="text-xl font-bold">Data That Will Be Deleted</h2>
              </div>
              
              <p className="text-white/70 mb-4">
                Upon verification of the request, AfriShop will delete:
              </p>
              
              <ul className="space-y-3">
                {deletedData.map((item, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-400 mt-2.5 flex-shrink-0" />
                    <span className="text-white/70">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Data Retained */}
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
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-orange-500/20 to-amber-500/20 flex items-center justify-center">
                  <AlertCircle className="h-6 w-6 text-orange-400" />
                </div>
                <h2 className="text-xl font-bold">Data That May Be Retained</h2>
              </div>
              
              <p className="text-white/70 mb-4">
                Certain data may be retained for legal, accounting, or regulatory purposes, including:
              </p>
              
              <ul className="space-y-3 mb-6">
                {retainedData.map((item, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span className="w-1.5 h-1.5 rounded-full bg-orange-400 mt-2.5 flex-shrink-0" />
                    <span className="text-white/70">{item}</span>
                  </li>
                ))}
              </ul>
              
              <p className="text-white/70 pt-4 border-t border-white/10">
                AfriShop does not retain full card numbers, CVV codes, or mobile money PINs.
              </p>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Retention Period */}
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
                  <ShieldCheck className="h-6 w-6 text-blue-400" />
                </div>
                <h2 className="text-xl font-bold">Retention Period</h2>
              </div>
              
              <p className="text-white/70 leading-relaxed">
                Any data retained for legal or regulatory reasons will be kept only for the minimum period required by applicable laws and will be securely deleted afterward.
              </p>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Processing Time */}
      <section className="py-16">
        <div className="container mx-auto px-4">
          <motion.div 
            className="max-w-3xl mx-auto"
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <div className="bg-gradient-to-br from-green-500/10 to-emerald-500/5 rounded-3xl p-8 border border-green-500/20">
              <div className="flex items-center gap-4 mb-6">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-green-500/20 to-emerald-500/20 flex items-center justify-center">
                  <Clock className="h-6 w-6 text-green-400" />
                </div>
                <h2 className="text-xl font-bold">Processing Time</h2>
              </div>
              
              <p className="text-white/70 leading-relaxed mb-6">
                Account deletion requests are typically processed within <strong className="text-white">7 to 30 business days</strong>.
              </p>
              
              <div className="flex items-center gap-4 p-4 bg-black/30 rounded-2xl">
                <div className="w-12 h-12 rounded-xl bg-green-500/20 flex items-center justify-center">
                  <Mail className="h-6 w-6 text-green-400" />
                </div>
                <div>
                  <p className="text-sm text-white/50">Contact Email</p>
                  <a href="mailto:nkadimisha@afrishop-usa.com" className="text-white hover:text-green-400 transition-colors">
                    nkadimisha@afrishop-usa.com
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

export default DeleteAccount;
