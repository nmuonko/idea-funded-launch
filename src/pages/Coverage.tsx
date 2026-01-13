import { useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, GeoJSON } from "react-leaflet";
import { motion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { Globe, CheckCircle, Clock, ArrowRight, MapPin } from "lucide-react";
import { PublicHeader, PublicFooter } from "@/components/public/PublicLayout";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Fix for default marker icons in react-leaflet
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
});

// Custom green marker for active countries
const activeIcon = new L.Icon({
  iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

// Custom orange marker for upcoming countries
const upcomingIcon = new L.Icon({
  iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-orange.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

interface SupportedCountry {
  id: string;
  country_code: string;
  country_name: string;
  latitude: number;
  longitude: number;
  is_active: boolean;
}

// Upcoming countries with coordinates
const upcomingCountries = [
  { name: "Rwanda", code: "RWA", lat: -1.9403, lng: 29.8739 },
  { name: "Uganda", code: "UGA", lat: 1.3733, lng: 32.2903 },
  { name: "Kenya", code: "KEN", lat: -0.0236, lng: 37.9062 },
  { name: "Tanzania", code: "TZA", lat: -6.369, lng: 34.8888 },
];

// Accurate DRC GeoJSON from Natural Earth (ISO: COD - Democratic Republic of the Congo)
// This is NOT the Republic of the Congo (COG/Brazzaville) - this is the larger DRC (Kinshasa)
const DRC_GEOJSON: GeoJSON.Feature = {
  type: "Feature",
  properties: { 
    name: "Democratic Republic of the Congo", 
    iso_a3: "COD",
    iso_a2: "CD"
  },
  geometry: {
    type: "MultiPolygon",
    coordinates: [[[[29.339998,-4.499983],[29.519987,-5.419979],[29.419993,-5.939999],[29.620032,-6.520015],[30.199997,-7.079981],[30.740015,-8.340007],[30.346086,-8.238257],[29.002912,-8.407032],[28.734867,-8.526559],[28.449871,-9.164918],[28.673682,-9.605925],[28.49607,-10.789884],[28.372253,-11.793647],[28.642417,-11.971569],[29.341548,-12.360744],[29.616001,-12.178895],[29.69961399999999,-13.257227],[28.934286,-13.248958],[28.523562,-12.698604],[28.155109,-12.272481],[27.388799,-12.132747],[27.16442,-11.608748],[26.553088,-11.92444],[25.752309,-11.784965],[25.418118,-11.330936],[24.78317,-11.238694],[24.314516,-11.262826],[24.257155,-10.951993],[23.912215,-10.926826],[23.456791,-10.867863],[22.837345,-11.017622],[22.402798,-10.993075],[22.155268,-11.084801],[22.208753,-9.894796],[21.875182,-9.523708],[21.801801,-8.908707],[21.949131,-8.305901],[21.746456,-7.920085],[21.728111,-7.290872],[20.514748,-7.299606],[20.601823,-6.939318],[20.091622,-6.943090],[20.037723,-7.116361],[19.417502,-7.155429],[19.166613,-7.738184],[19.016752,-7.988246],[18.464176,-7.847014],[18.134222,-7.987678],[17.47297,-8.068551],[17.089996,-7.545689],[16.860191,-7.222298],[16.57318,-6.622645],[16.326528,-5.877470],[13.375597,-5.864241],[12.318608,-6.100092],[12.180337,-5.789931],[12.436688,-5.684304],[12.468004,-5.248362],[12.631612,-4.991271],[12.995517,-4.781103],[13.25824,-4.882957],[13.600235,-4.500138],[14.144956,-4.510009],[14.209035,-4.793092],[14.582604,-4.970239],[15.170992,-4.343507],[15.75354,-3.855165],[16.00629,-3.535133],[15.972803,-2.712392],[16.407092,-1.740927],[16.865307,-1.225816],[17.523716,-0.74383],[17.638645,-0.424832],[17.663553,-0.058084],[17.826540,0.288923],[17.774192,0.855659],[17.898835,1.741832],[18.094276,2.365722],[18.393792,2.900443],[18.453065,3.504386],[18.542982,4.201785],[18.932312,4.709506],[19.467784,5.031528],[20.290679,4.691678],[20.927591,4.322786],[21.659123,4.224342],[22.405124,4.029160],[22.704124,4.633051],[22.841480,4.710126],[23.297214,4.609693],[24.410531,5.108784],[24.805029,4.897247],[25.128833,4.927245],[25.278798,5.170408],[25.650455,5.256088],[26.402761,5.150875],[27.044065,5.127853],[27.374226,5.233944],[27.979977,4.408413],[28.428994,4.287155],[28.696678,4.455077],[29.159078,4.389267],[29.715995,4.600805],[29.953500,4.173699],[30.833852,3.509172],[30.833386,3.509166],[30.773347,2.339883],[31.174149,2.204465],[30.852670,1.849396],[30.468508,1.583805],[30.086154,1.062313],[29.875779,0.597379],[29.819503,-0.205310],[29.587838,-0.587406],[29.579466,-1.341313],[29.291887,-1.620056],[29.254835,-2.215109],[29.117479,-2.292211],[29.024926,-2.839258],[29.276384,-3.293907],[29.339998,-4.499983]]]],
  }
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

      if (!error && data && data.length > 0) {
        setCountries(data);
      } else {
        // Fallback to DRC
        setCountries([{
          id: 'default-drc',
          country_code: 'CD',
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


  const upcomingFiltered = upcomingCountries.filter(
    u => !countries.some(c => c.country_code === u.code)
  );

  // Style for active country polygons
  const activeCountryStyle = {
    fillColor: "#10b981",
    fillOpacity: 0.5,
    color: "#34d399",
    weight: 2,
  };

  // Style for upcoming country polygons
  const upcomingCountryStyle = {
    fillColor: "#f59e0b",
    fillOpacity: 0.25,
    color: "#fbbf24",
    weight: 1,
    dashArray: "5, 5",
  };

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
        <div className="max-w-6xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
            className="relative rounded-3xl overflow-hidden bg-slate-900/50 backdrop-blur-sm border border-slate-700/50"
          >
            {loading ? (
              <div className="flex items-center justify-center h-[500px]">
                <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-emerald-500"></div>
              </div>
            ) : (
              <div className="h-[500px] md:h-[600px] w-full">
                <MapContainer
                  center={[2, 20]}
                  zoom={3}
                  scrollWheelZoom={false}
                  style={{ height: "100%", width: "100%", background: "#0c1322" }}
                  className="rounded-3xl"
                >
                  {/* Dark, muted tile layer - easy on the eyes */}
                  <TileLayer
                    attribution='&copy; <a href="https://carto.com/">CARTO</a>'
                    url="https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png"
                  />
                  
                  {/* DRC highlighted polygon - embedded for reliability */}
                  <GeoJSON
                    key="drc-polygon"
                    data={DRC_GEOJSON}
                    style={activeCountryStyle}
                  />

                  {/* Upcoming countries - markers only, no polygon fill */}
                  
                  {/* Active country markers */}
                  {countries.map((country) => (
                    <Marker
                      key={country.id}
                      position={[country.latitude, country.longitude]}
                      icon={activeIcon}
                    >
                      <Popup>
                        <div className="text-center p-1">
                          <strong className="text-emerald-600 text-base">{country.country_name}</strong>
                          <p className="text-sm text-gray-600 mt-1">✓ Active Service Zone</p>
                        </div>
                      </Popup>
                    </Marker>
                  ))}

                  {/* Upcoming country markers */}
                  {upcomingFiltered.map((country) => (
                    <Marker
                      key={country.code}
                      position={[country.lat, country.lng]}
                      icon={upcomingIcon}
                    >
                      <Popup>
                        <div className="text-center p-1">
                          <strong className="text-amber-600 text-base">{country.name}</strong>
                          <p className="text-sm text-gray-600 mt-1">Coming Soon</p>
                        </div>
                      </Popup>
                    </Marker>
                  ))}
                </MapContainer>
              </div>
            )}

            {/* Legend */}
            <div className="flex flex-wrap items-center justify-center gap-6 p-6 border-t border-slate-700/50 bg-slate-900/80">
              <div className="flex items-center gap-2 text-sm text-white">
                <div className="w-4 h-4 rounded-full bg-emerald-500" />
                <span>Active Service Zone</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-amber-400">
                <div className="w-4 h-4 rounded-full bg-amber-500" />
                <span>Coming Soon</span>
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
            {countries.map((country, index) => (
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
            ))}
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
            {upcomingFiltered.map((country, index) => (
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
