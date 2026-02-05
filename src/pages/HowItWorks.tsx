import { ArrowRight, Download, Package, Globe, Truck, Shield, HeadphonesIcon, Smartphone, XCircle } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
 import { PublicHeader } from "@/components/public/PublicLayout";
 import { ShopFooter } from "@/components/shop/ShopFooter";

const fadeInUp = {
  initial: { opacity: 0, y: 30 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.6 }
};

const staggerContainer = {
  animate: { transition: { staggerChildren: 0.1 } }
};

const HowItWorks = () => {
  const steps = [
    { number: "01", title: "Download the App", description: "Get the AfriShop mobile app from your device's app store." },
    { number: "02", title: "Add Products to Cart", description: "Browse supported U.S. stores or paste a product link to add items to your cart." },
    { number: "03", title: "Review Cost Estimate", description: "AfriShop calculates estimated costs including product price, shipping, customs, and service fees." },
    { number: "04", title: "Confirm Your Order", description: "Review and confirm your order within the app." },
    { number: "05", title: "Complete Payment", description: "Payment is completed securely inside the app using licensed payment providers." },
    { number: "06", title: "We Coordinate Delivery", description: "AfriShop coordinates product purchasing and delivery to your location." },
    { number: "07", title: "Track & Receive", description: "Receive order updates and tracking until delivery." }
  ];

  const services = [
    { icon: Package, title: "Order Facilitation", description: "We assist with placing orders from international retailers." },
    { icon: Globe, title: "International Shipping", description: "We coordinate shipping logistics from origin to destination." },
    { icon: Shield, title: "Customs Assistance", description: "We help facilitate customs clearance processes." },
    { icon: Truck, title: "Local Delivery", description: "We coordinate last-mile delivery through trusted partners." },
    { icon: HeadphonesIcon, title: "Customer Support", description: "Our team assists with order issues and inquiries." }
  ];

  const limitations = [
    "AfriShop is not affiliated with third-party retailers",
    "AfriShop does not operate an open marketplace",
    "AfriShop does not store sensitive payment credentials",
    "AfriShop does not provide financial services"
  ];

  return (
    <div className="min-h-screen bg-black text-white">
      <PublicHeader />

      {/* Hero Section */}
      <section className="relative min-h-screen flex items-center justify-center overflow-hidden pt-20">
        {/* Background gradient */}
        <div className="absolute inset-0 bg-gradient-to-br from-slate-900/40 via-black to-slate-800/30" />
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-slate-600/10 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-slate-500/10 rounded-full blur-3xl" />
        
        {/* Africa Map Silhouette - clear and visible */}
        <div className="absolute right-0 top-1/2 -translate-y-1/2 w-[500px] h-[600px] md:w-[600px] md:h-[700px] opacity-20 pointer-events-none">
          <svg viewBox="0 0 400 500" fill="currentColor" className="w-full h-full text-cyan-400">
            <path d="M200 20 L220 25 L240 30 L260 28 L280 35 L295 45 L310 55 L320 70 L330 90 L340 110 L345 130 L348 150 L350 170 L348 190 L345 210 L340 230 L335 250 L330 270 L320 290 L310 310 L295 330 L280 350 L265 370 L250 385 L235 395 L220 405 L200 415 L180 420 L160 425 L140 420 L120 410 L100 395 L85 375 L75 355 L65 330 L60 305 L55 280 L52 255 L50 230 L52 205 L55 180 L60 155 L70 130 L85 110 L100 90 L120 70 L140 55 L160 40 L180 28 Z" />
          </svg>
        </div>
        
        <div className="container mx-auto px-4 relative z-10">
          <motion.div 
            className="max-w-4xl mx-auto text-center"
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5, delay: 0.2 }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/10 mb-8"
            >
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              <span className="text-sm text-white/70">Now serving Central Africa</span>
            </motion.div>
            
            {/* Bold tagline with arrow */}
            <motion.div
              initial={{ opacity: 0, x: -30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.6, delay: 0.3 }}
              className="flex flex-col md:flex-row items-center justify-center gap-4 md:gap-6 mb-8"
            >
              <h1 className="text-4xl md:text-6xl lg:text-7xl font-bold text-white whitespace-nowrap">
                Shop the U.S.
              </h1>
              <motion.div 
                className="flex items-center"
                animate={{ x: [0, 10, 0] }}
                transition={{ repeat: Infinity, duration: 1.5, ease: "easeInOut" }}
              >
                <div className="hidden md:block w-16 lg:w-24 h-0.5 bg-gradient-to-r from-cyan-400 to-cyan-500" />
                <ArrowRight className="h-10 w-10 md:h-12 md:w-12 lg:h-14 lg:w-14 text-cyan-400" />
              </motion.div>
              <h1 className="text-4xl md:text-6xl lg:text-7xl font-bold bg-gradient-to-r from-cyan-400 via-blue-400 to-cyan-300 bg-clip-text text-transparent whitespace-nowrap">
                Delivered to Africa
              </h1>
            </motion.div>
            
            <p className="text-lg md:text-xl text-white/60 max-w-2xl mx-auto mb-10">
              Order from Amazon, Walmart, eBay and more. We handle shipping, customs, and delivery right to your door.
            </p>
            
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link to="/download">
                <Button size="lg" className="bg-slate-700 hover:bg-slate-600 text-white border-0 rounded-full px-8 h-14 text-lg">
                  <Download className="h-5 w-5 mr-2" />
                  Download App
                </Button>
              </Link>
              <a href="#how-it-works">
                <Button size="lg" variant="outline" className="border-white/20 text-white hover:bg-white/10 rounded-full px-8 h-14 text-lg">
                  Learn More
                  <ArrowRight className="h-5 w-5 ml-2" />
                </Button>
              </a>
            </div>
          </motion.div>
        </div>

        {/* Scroll indicator */}
        <motion.div 
          className="absolute bottom-10 left-1/2 -translate-x-1/2"
          animate={{ y: [0, 10, 0] }}
          transition={{ repeat: Infinity, duration: 2 }}
        >
          <div className="w-6 h-10 rounded-full border-2 border-white/30 flex items-start justify-center p-2">
            <motion.div 
              className="w-1.5 h-1.5 rounded-full bg-white/50"
              animate={{ y: [0, 16, 0] }}
              transition={{ repeat: Infinity, duration: 2 }}
            />
          </div>
        </motion.div>
      </section>

      {/* What Is AfriShop */}
      <section className="py-24 relative" id="how-it-works">
        <div className="container mx-auto px-4">
          <motion.div 
            className="max-w-4xl mx-auto"
            initial="initial"
            whileInView="animate"
            viewport={{ once: true }}
            variants={staggerContainer}
          >
            <motion.h2 
              variants={fadeInUp}
              className="text-3xl md:text-5xl font-bold mb-8 text-center"
            >
              What Is <span className="bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">AfriShop</span>?
            </motion.h2>
            <motion.div 
              variants={fadeInUp}
              className="bg-gradient-to-br from-white/5 to-white/0 backdrop-blur-xl rounded-3xl p-8 md:p-12 border border-white/10"
            >
              <p className="text-lg text-white/70 leading-relaxed text-center">
                AfriShop is a mobile application that assists users in Africa with purchasing products 
                from international online retailers that may not ship directly to their country.
              </p>
              <p className="text-lg text-white/70 leading-relaxed mt-4 text-center">
                We provide ordering assistance, international shipping coordination, customs 
                facilitation, and last-mile delivery through trusted partners.
              </p>
              <p className="text-white/90 leading-relaxed mt-6 text-center font-medium">
                AfriShop does not manufacture, own, or directly sell third-party products.
              </p>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* Steps */}
      <section className="py-24 relative">
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-blue-900/10 to-transparent" />
        <div className="container mx-auto px-4 relative z-10">
          <motion.h2 
            className="text-3xl md:text-5xl font-bold mb-16 text-center"
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            How It <span className="bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">Works</span>
          </motion.h2>
          
          <div className="max-w-4xl mx-auto space-y-6">
            {steps.map((step, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, x: index % 2 === 0 ? -30 : 30 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
                className="group relative"
              >
                <div className="flex items-start gap-6 p-6 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all duration-300">
                  <div className="flex-shrink-0 w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center">
                    <span className="text-xl font-bold text-white">{step.number}</span>
                  </div>
                  <div className="flex-1 pt-1">
                    <h3 className="text-xl font-semibold text-white mb-2">{step.title}</h3>
                    <p className="text-white/60">{step.description}</p>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Services */}
      <section className="py-24">
        <div className="container mx-auto px-4">
          <motion.h2 
            className="text-3xl md:text-5xl font-bold mb-16 text-center"
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            What We <span className="bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">Handle</span>
          </motion.h2>
          
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-6xl mx-auto">
            {services.map((service, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
                className="group p-8 rounded-3xl bg-gradient-to-br from-white/5 to-transparent border border-white/10 hover:border-white/20 transition-all duration-300"
              >
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-500/20 to-cyan-500/20 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                  <service.icon className="h-7 w-7 text-cyan-400" />
                </div>
                <h3 className="text-xl font-semibold text-white mb-3">{service.title}</h3>
                <p className="text-white/60">{service.description}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Limitations */}
      <section className="py-24 relative">
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-red-900/5 to-transparent" />
        <div className="container mx-auto px-4 relative z-10">
          <motion.div 
            className="max-w-3xl mx-auto"
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <div className="flex items-center justify-center gap-3 mb-8">
              <XCircle className="h-8 w-8 text-white/40" />
              <h2 className="text-3xl md:text-4xl font-bold text-center">
                What We <span className="text-white/60">Don't Do</span>
              </h2>
            </div>
            <div className="space-y-3">
              {limitations.map((item, index) => (
                <motion.div 
                  key={index}
                  initial={{ opacity: 0, x: -20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: index * 0.1 }}
                  className="flex items-center gap-4 p-5 rounded-2xl bg-white/5 border border-white/10"
                >
                  <div className="w-2 h-2 rounded-full bg-white/30" />
                  <p className="text-white/70">{item}</p>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </div>
      </section>

      {/* Disclaimer */}
      <section className="py-12 border-y border-white/10">
        <div className="container mx-auto px-4">
          <p className="text-center text-white/40 text-sm max-w-2xl mx-auto">
            <strong className="text-white/60">Disclaimer:</strong> All third-party trademarks belong to their respective owners. 
            AfriShop operates independently and is not affiliated with any third-party retailer or brand.
          </p>
        </div>
      </section>

      {/* CTA */}
      <section className="py-32 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-900/30 via-black to-cyan-900/30" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-blue-500/20 rounded-full blur-3xl" />
        
        <div className="container mx-auto px-4 relative z-10 text-center">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <Smartphone className="h-20 w-20 text-cyan-400 mx-auto mb-8" />
            <h2 className="text-3xl md:text-5xl font-bold mb-6">
              Ready to <span className="bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">Get Started</span>?
            </h2>
            <p className="text-xl text-white/60 mb-10 max-w-xl mx-auto">
              Download the AfriShop app and start shopping from U.S. stores today.
            </p>
            <Link to="/download">
              <Button size="lg" className="bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white border-0 rounded-full px-10 h-16 text-lg">
                <Download className="h-5 w-5 mr-3" />
                Download the App
                <ArrowRight className="h-5 w-5 ml-3" />
              </Button>
            </Link>
          </motion.div>
        </div>
      </section>

       <ShopFooter />
    </div>
  );
};

export default HowItWorks;
