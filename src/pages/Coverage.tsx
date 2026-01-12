import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { MapPin, Globe, CheckCircle, Clock, ArrowRight } from "lucide-react";
import { PublicHeader, PublicFooter } from "@/components/public/PublicLayout";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";

interface SupportedCountry {
  id: string;
  country_code: string;
  country_name: string;
  latitude: number;
  longitude: number;
  is_active: boolean;
}

// Upcoming countries (not yet in database but planned)
const upcomingCountries = [
  { name: "Rwanda", code: "RWA" },
  { name: "Uganda", code: "UGA" },
  { name: "Kenya", code: "KEN" },
  { name: "Tanzania", code: "TZA" },
];

// Simple Africa SVG map with country paths
const AfricaMap = ({ activeCountries, upcomingCodes }: { activeCountries: string[]; upcomingCodes: string[] }) => {
  return (
    <svg viewBox="0 0 800 900" className="w-full h-auto max-h-[600px]">
      <defs>
        <filter id="glow">
          <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
          <feMerge>
            <feMergeNode in="coloredBlur"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>
      </defs>
      
      {/* Background */}
      <rect width="800" height="900" fill="#0f172a" />
      
      {/* Africa continent simplified paths */}
      {/* Morocco */}
      <path d="M200,120 L280,100 L300,140 L280,180 L220,200 L180,160 Z" 
        fill={activeCountries.includes('MAR') ? '#10b981' : upcomingCodes.includes('MAR') ? '#f59e0b' : '#334155'} 
        stroke="#1e293b" strokeWidth="2" className="transition-all hover:opacity-80 cursor-pointer"/>
      
      {/* Algeria */}
      <path d="M280,100 L400,80 L450,150 L420,280 L300,260 L280,180 L300,140 Z" 
        fill={activeCountries.includes('DZA') ? '#10b981' : upcomingCodes.includes('DZA') ? '#f59e0b' : '#334155'} 
        stroke="#1e293b" strokeWidth="2" className="transition-all hover:opacity-80 cursor-pointer"/>
      
      {/* Tunisia */}
      <path d="M400,80 L420,70 L440,100 L420,130 L400,120 Z" 
        fill={activeCountries.includes('TUN') ? '#10b981' : upcomingCodes.includes('TUN') ? '#f59e0b' : '#334155'} 
        stroke="#1e293b" strokeWidth="2" className="transition-all hover:opacity-80 cursor-pointer"/>
      
      {/* Libya */}
      <path d="M420,70 L550,80 L560,200 L480,280 L420,280 L450,150 L440,100 Z" 
        fill={activeCountries.includes('LBY') ? '#10b981' : upcomingCodes.includes('LBY') ? '#f59e0b' : '#334155'} 
        stroke="#1e293b" strokeWidth="2" className="transition-all hover:opacity-80 cursor-pointer"/>
      
      {/* Egypt */}
      <path d="M550,80 L620,100 L640,200 L600,280 L560,200 Z" 
        fill={activeCountries.includes('EGY') ? '#10b981' : upcomingCodes.includes('EGY') ? '#f59e0b' : '#334155'} 
        stroke="#1e293b" strokeWidth="2" className="transition-all hover:opacity-80 cursor-pointer"/>
      
      {/* Sudan */}
      <path d="M560,200 L600,280 L620,380 L560,420 L500,400 L480,320 L480,280 Z" 
        fill={activeCountries.includes('SDN') ? '#10b981' : upcomingCodes.includes('SDN') ? '#f59e0b' : '#334155'} 
        stroke="#1e293b" strokeWidth="2" className="transition-all hover:opacity-80 cursor-pointer"/>

      {/* Ethiopia */}
      <path d="M560,420 L620,380 L680,420 L660,500 L580,520 L540,480 Z" 
        fill={activeCountries.includes('ETH') ? '#10b981' : upcomingCodes.includes('ETH') ? '#f59e0b' : '#334155'} 
        stroke="#1e293b" strokeWidth="2" className="transition-all hover:opacity-80 cursor-pointer"/>
      
      {/* Kenya */}
      <path d="M580,520 L660,500 L680,560 L640,620 L560,580 Z" 
        fill={activeCountries.includes('KEN') ? '#10b981' : upcomingCodes.includes('KEN') ? '#f59e0b' : '#334155'} 
        stroke="#1e293b" strokeWidth="2" className="transition-all hover:opacity-80 cursor-pointer"/>
      
      {/* Tanzania */}
      <path d="M560,580 L640,620 L620,700 L520,720 L500,640 Z" 
        fill={activeCountries.includes('TZA') ? '#10b981' : upcomingCodes.includes('TZA') ? '#f59e0b' : '#334155'} 
        stroke="#1e293b" strokeWidth="2" className="transition-all hover:opacity-80 cursor-pointer"/>
      
      {/* Uganda */}
      <path d="M520,520 L560,520 L560,580 L500,600 L480,560 Z" 
        fill={activeCountries.includes('UGA') ? '#10b981' : upcomingCodes.includes('UGA') ? '#f59e0b' : '#334155'} 
        stroke="#1e293b" strokeWidth="2" className="transition-all hover:opacity-80 cursor-pointer"/>
      
      {/* Rwanda */}
      <path d="M500,600 L520,600 L520,630 L490,630 Z" 
        fill={activeCountries.includes('RWA') ? '#10b981' : upcomingCodes.includes('RWA') ? '#f59e0b' : '#334155'} 
        stroke="#1e293b" strokeWidth="2" className="transition-all hover:opacity-80 cursor-pointer"/>
      
      {/* DRC - Democratic Republic of Congo - MAIN HIGHLIGHT */}
      <path d="M320,420 L420,400 L480,450 L500,520 L500,640 L440,700 L360,720 L280,680 L260,580 L280,480 Z" 
        fill={activeCountries.includes('COD') ? '#10b981' : upcomingCodes.includes('COD') ? '#f59e0b' : '#334155'} 
        stroke="#1e293b" strokeWidth="2" 
        filter={activeCountries.includes('COD') ? 'url(#glow)' : ''}
        className="transition-all hover:opacity-80 cursor-pointer"/>
      
      {/* Congo (Brazzaville) */}
      <path d="M280,480 L320,420 L360,450 L340,520 L280,540 Z" 
        fill={activeCountries.includes('COG') ? '#10b981' : upcomingCodes.includes('COG') ? '#f59e0b' : '#334155'} 
        stroke="#1e293b" strokeWidth="2" className="transition-all hover:opacity-80 cursor-pointer"/>
      
      {/* Angola */}
      <path d="M260,580 L280,540 L340,560 L360,720 L280,760 L200,700 L220,620 Z" 
        fill={activeCountries.includes('AGO') ? '#10b981' : upcomingCodes.includes('AGO') ? '#f59e0b' : '#334155'} 
        stroke="#1e293b" strokeWidth="2" className="transition-all hover:opacity-80 cursor-pointer"/>
      
      {/* Zambia */}
      <path d="M360,720 L440,700 L500,720 L520,780 L440,800 L360,780 Z" 
        fill={activeCountries.includes('ZMB') ? '#10b981' : upcomingCodes.includes('ZMB') ? '#f59e0b' : '#334155'} 
        stroke="#1e293b" strokeWidth="2" className="transition-all hover:opacity-80 cursor-pointer"/>
      
      {/* Nigeria */}
      <path d="M200,340 L280,320 L320,380 L280,440 L200,420 L180,380 Z" 
        fill={activeCountries.includes('NGA') ? '#10b981' : upcomingCodes.includes('NGA') ? '#f59e0b' : '#334155'} 
        stroke="#1e293b" strokeWidth="2" className="transition-all hover:opacity-80 cursor-pointer"/>
      
      {/* Cameroon */}
      <path d="M280,320 L340,340 L360,420 L320,420 L280,440 L320,380 Z" 
        fill={activeCountries.includes('CMR') ? '#10b981' : upcomingCodes.includes('CMR') ? '#f59e0b' : '#334155'} 
        stroke="#1e293b" strokeWidth="2" className="transition-all hover:opacity-80 cursor-pointer"/>
      
      {/* South Africa */}
      <path d="M360,780 L440,800 L520,820 L540,860 L420,880 L320,860 L300,800 Z" 
        fill={activeCountries.includes('ZAF') ? '#10b981' : upcomingCodes.includes('ZAF') ? '#f59e0b' : '#334155'} 
        stroke="#1e293b" strokeWidth="2" className="transition-all hover:opacity-80 cursor-pointer"/>
      
      {/* West African countries simplified */}
      <path d="M80,280 L160,260 L200,300 L180,360 L100,360 L60,320 Z" 
        fill="#334155" stroke="#1e293b" strokeWidth="2" className="transition-all hover:opacity-80 cursor-pointer"/>
      
      {/* Marker for DRC if active */}
      {activeCountries.includes('COD') && (
        <g>
          <circle cx="380" cy="560" r="12" fill="#10b981" stroke="#fff" strokeWidth="3">
            <animate attributeName="r" values="12;16;12" dur="2s" repeatCount="indefinite"/>
          </circle>
          <circle cx="380" cy="560" r="24" fill="#10b981" opacity="0.3">
            <animate attributeName="r" values="24;32;24" dur="2s" repeatCount="indefinite"/>
            <animate attributeName="opacity" values="0.3;0.1;0.3" dur="2s" repeatCount="indefinite"/>
          </circle>
        </g>
      )}
    </svg>
  );
};

export default function Coverage() {
  const [countries, setCountries] = useState<SupportedCountry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchCountries() {
      const { data, error } = await supabase
        .from("supported_countries")
        .select("*")
        .eq("is_active", true);

      console.log("Fetched countries:", data, error);
      
      if (!error && data && data.length > 0) {
        setCountries(data);
      } else {
        // Fallback to DRC if no data or error
        setCountries([{
          id: 'default-drc',
          country_code: 'COD',
          country_name: 'Democratic Republic of the Congo',
          latitude: -4.0383,
          longitude: 21.7587,
          is_active: true,
        }]);
      }
      setLoading(false);
    }

    fetchCountries();
  }, []);

  // Always include DRC as active if not already in the list
  const activeCountryCodes = countries.length > 0 
    ? countries.map((c) => c.country_code)
    : ['COD'];
  const upcomingCodes = upcomingCountries
    .filter(u => !countries.some(c => c.country_code === u.code))
    .map(u => u.code);

  return (
    <div className="min-h-screen bg-black text-white">
      <PublicHeader />

      {/* Hero Section */}
      <section className="relative pt-32 pb-16 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-900/20 via-black to-slate-900/20" />
        <div className="absolute top-1/3 left-1/4 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/3 w-80 h-80 bg-cyan-500/10 rounded-full blur-3xl" />

        <div className="container mx-auto px-4 relative z-10">
          <motion.div
            className="max-w-3xl mx-auto text-center"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.2 }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-500/10 border border-emerald-500/20 mb-6"
            >
              <Globe className="w-4 h-4 text-emerald-400" />
              <span className="text-emerald-400 text-sm font-medium">Expanding Across Africa</span>
            </motion.div>

            <h1 className="text-4xl md:text-6xl font-bold mb-6">
              Our <span className="bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">Coverage</span>
            </h1>
            <p className="text-lg text-white/60 max-w-2xl mx-auto">
              We're bringing international shopping to Africa, one country at a time. See where AfriShop delivers today and where we're heading next.
            </p>
          </motion.div>
        </div>
      </section>

      {/* Map Section */}
      <section className="py-12 px-4">
        <div className="max-w-5xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
            className="relative rounded-3xl overflow-hidden bg-slate-900/50 backdrop-blur-sm border border-slate-700/50 p-8"
          >
            {/* Glow effect */}
            <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 via-transparent to-cyan-500/5 pointer-events-none" />

            {loading ? (
              <div className="flex items-center justify-center h-[400px]">
                <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-emerald-500"></div>
              </div>
            ) : (
              <AfricaMap activeCountries={activeCountryCodes} upcomingCodes={upcomingCodes} />
            )}

            {/* Legend */}
            <div className="flex flex-wrap items-center justify-center gap-6 mt-8 pt-6 border-t border-slate-700/50">
              <div className="flex items-center gap-2 text-sm text-white">
                <div className="w-4 h-4 rounded bg-emerald-500" />
                <span>Active Service Zone</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-amber-400">
                <div className="w-4 h-4 rounded bg-amber-500" />
                <span>Coming Soon</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-slate-400">
                <div className="w-4 h-4 rounded bg-slate-600" />
                <span>Future Expansion</span>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Active Countries Grid */}
      <section className="py-16 px-4">
        <div className="max-w-6xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-12"
          >
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              Currently <span className="text-emerald-400">Serving</span>
            </h2>
            <p className="text-white/60 max-w-xl mx-auto">
              We're live in these countries with full delivery and support services.
            </p>
          </motion.div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {countries.length > 0 ? (
              countries.map((country, index) => (
                <motion.div
                  key={country.id}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: index * 0.1 }}
                  className="flex items-center gap-4 p-6 rounded-2xl bg-gradient-to-br from-emerald-500/10 to-transparent border border-emerald-500/20 hover:border-emerald-500/40 transition-all"
                >
                  <div className="w-12 h-12 rounded-xl bg-emerald-500/20 flex items-center justify-center">
                    <CheckCircle className="w-6 h-6 text-emerald-400" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-white">{country.country_name}</h3>
                    <p className="text-sm text-emerald-400">Active</p>
                  </div>
                </motion.div>
              ))
            ) : (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="col-span-full flex items-center gap-4 p-6 rounded-2xl bg-gradient-to-br from-emerald-500/10 to-transparent border border-emerald-500/20"
              >
                <div className="w-12 h-12 rounded-xl bg-emerald-500/20 flex items-center justify-center">
                  <CheckCircle className="w-6 h-6 text-emerald-400" />
                </div>
                <div>
                  <h3 className="font-semibold text-white">Democratic Republic of the Congo</h3>
                  <p className="text-sm text-emerald-400">Active - Primary Market</p>
                </div>
              </motion.div>
            )}
          </div>
        </div>
      </section>

      {/* Coming Soon Section */}
      <section className="py-16 px-4 relative">
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-amber-900/5 to-transparent" />
        <div className="max-w-6xl mx-auto relative z-10">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-12"
          >
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              <span className="text-amber-400">Coming</span> Soon
            </h2>
            <p className="text-white/60 max-w-xl mx-auto">
              We're actively working to expand to these countries. Stay tuned!
            </p>
          </motion.div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {upcomingCountries
              .filter(u => !countries.some(c => c.country_code === u.code))
              .map((country, index) => (
                <motion.div
                  key={country.code}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: index * 0.1 }}
                  className="flex items-center gap-4 p-5 rounded-2xl bg-gradient-to-br from-amber-500/10 to-transparent border border-amber-500/20"
                >
                  <div className="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center">
                    <Clock className="w-5 h-5 text-amber-400" />
                  </div>
                  <div>
                    <h3 className="font-medium text-white">{country.name}</h3>
                    <p className="text-xs text-amber-400/70">Coming soon</p>
                  </div>
                </motion.div>
              ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-24 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-900/30 via-black to-cyan-900/30" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-emerald-500/20 rounded-full blur-3xl" />

        <div className="container mx-auto px-4 relative z-10 text-center">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <MapPin className="h-16 w-16 text-emerald-400 mx-auto mb-6" />
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              In Your <span className="text-emerald-400">Region</span>?
            </h2>
            <p className="text-lg text-white/60 mb-8 max-w-md mx-auto">
              Download the AfriShop app and start shopping from U.S. stores today.
            </p>
            <Link to="/download">
              <Button size="lg" className="bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-600 hover:to-cyan-600 text-white border-0 rounded-full px-8 h-14 text-lg">
                Get the App
                <ArrowRight className="h-5 w-5 ml-2" />
              </Button>
            </Link>
          </motion.div>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}
