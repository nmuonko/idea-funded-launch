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

// Embedded accurate DRC GeoJSON (simplified but complete borders)
const DRC_GEOJSON: GeoJSON.Feature = {
  type: "Feature",
  properties: { name: "Democratic Republic of the Congo", iso_a3: "COD" },
  geometry: {
    type: "Polygon",
    coordinates: [[
      [29.34, -4.5], [29.28, -3.29], [29.02, -2.84], [29.12, -2.29], [29.4, -1.62],
      [29.59, -1.34], [29.82, -1.31], [29.58, -0.59], [29.48, 0.24], [29.92, 0.48],
      [30.08, 1.06], [30.47, 1.58], [30.75, 1.93], [30.83, 3.51], [30.42, 3.45],
      [29.99, 4.17], [29.17, 4.39], [28.7, 4.46], [28.43, 4.29], [27.98, 4.41],
      [27.37, 5.23], [27.04, 5.13], [26.4, 5.15], [25.65, 5.26], [25.28, 5.17],
      [25.13, 4.93], [24.81, 4.9], [24.41, 5.11], [23.3, 4.61], [22.84, 4.71],
      [22.7, 4.63], [22.41, 4.03], [21.66, 4.22], [20.93, 4.32], [20.29, 4.69],
      [19.47, 5.03], [18.93, 4.71], [18.54, 4.2], [18.45, 3.5], [17.81, 3.56],
      [17.13, 3.73], [16.54, 3.2], [16.01, 2.27], [16.01, 1.68], [15.94, 1.73],
      [15.15, 2.04], [14.48, 2.15], [13.27, 2.16], [12.99, 1.8], [12.74, 1.35],
      [12.58, 1.26], [12.47, 0.94], [12.49, 0.38], [12.52, -0.09], [12.42, -0.51],
      [12.18, -0.87], [12.08, -1.52], [12.32, -1.78], [12.21, -2.2], [11.98, -2.55],
      [12.28, -2.48], [12.38, -2.55], [12.53, -2.39], [12.82, -2.38], [12.96, -2.59],
      [13.26, -2.31], [13.54, -2.38], [13.46, -2.72], [13.79, -2.88], [13.91, -3.07],
      [14.23, -3.01], [14.3, -2.39], [14.52, -2.3], [14.89, -2.54], [15.02, -2.66],
      [15.24, -2.88], [15.79, -2.63], [15.9, -2.15], [16.01, -1.93], [16.3, -1.82],
      [16.31, -1.61], [16.57, -1.04], [16.94, -0.94], [17.09, -0.55], [17.52, -0.03],
      [17.73, 0.08], [17.85, -0.03], [18.05, -0.08], [18.19, -0.45], [18.42, -0.5],
      [18.61, -0.28], [18.78, -0.11], [19.09, -0.14], [19.28, -0.09], [19.42, -0.61],
      [19.64, -0.75], [19.8, -0.53], [20.1, -0.54], [20.29, -0.72], [20.47, -0.84],
      [20.85, -0.9], [21.59, -1.23], [21.97, -1.37], [22.15, -1.67], [22.38, -1.82],
      [22.89, -1.39], [23.07, -1.16], [23.31, -1.0], [23.56, -1.12], [23.99, -1.08],
      [24.24, -1.03], [24.31, -1.28], [24.44, -1.37], [24.61, -1.27], [24.86, -1.11],
      [25.05, -1.08], [25.26, -1.09], [25.4, -1.29], [25.46, -1.53], [25.72, -1.78],
      [25.93, -1.85], [26.16, -1.89], [26.38, -1.86], [26.64, -1.72], [26.94, -1.76],
      [27.14, -1.98], [27.24, -2.19], [27.4, -2.45], [27.49, -2.77], [27.6, -2.93],
      [27.71, -3.08], [27.74, -3.32], [27.86, -3.54], [28.0, -3.73], [28.15, -3.92],
      [28.31, -4.17], [28.54, -4.35], [28.77, -4.45], [29.02, -4.43], [29.2, -4.46],
      [29.34, -4.5]
    ]]
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
                  
                  {/* DRC highlighted polygon - always rendered with embedded data */}
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
