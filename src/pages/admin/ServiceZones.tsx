import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Plus, Trash2, MapPin, Globe } from "lucide-react";

interface SupportedCountry {
  id: string;
  country_code: string;
  country_name: string;
  latitude: number;
  longitude: number;
  is_active: boolean;
  created_at: string;
}

// African countries with their coordinates
const AFRICAN_COUNTRIES = [
  { code: "COD", name: "Democratic Republic of the Congo", lat: -4.0383, lng: 21.7587 },
  { code: "COG", name: "Republic of the Congo", lat: -0.228, lng: 15.8277 },
  { code: "AGO", name: "Angola", lat: -11.2027, lng: 17.8739 },
  { code: "ZMB", name: "Zambia", lat: -13.1339, lng: 27.8493 },
  { code: "TZA", name: "Tanzania", lat: -6.369, lng: 34.8888 },
  { code: "KEN", name: "Kenya", lat: -0.0236, lng: 37.9062 },
  { code: "UGA", name: "Uganda", lat: 1.3733, lng: 32.2903 },
  { code: "RWA", name: "Rwanda", lat: -1.9403, lng: 29.8739 },
  { code: "BDI", name: "Burundi", lat: -3.3731, lng: 29.9189 },
  { code: "CAF", name: "Central African Republic", lat: 6.6111, lng: 20.9394 },
  { code: "SSD", name: "South Sudan", lat: 6.877, lng: 31.307 },
  { code: "SDN", name: "Sudan", lat: 12.8628, lng: 30.2176 },
  { code: "NGA", name: "Nigeria", lat: 9.082, lng: 8.6753 },
  { code: "GHA", name: "Ghana", lat: 7.9465, lng: -1.0232 },
  { code: "ZAF", name: "South Africa", lat: -30.5595, lng: 22.9375 },
  { code: "ETH", name: "Ethiopia", lat: 9.145, lng: 40.4897 },
  { code: "EGY", name: "Egypt", lat: 26.8206, lng: 30.8025 },
  { code: "MAR", name: "Morocco", lat: 31.7917, lng: -7.0926 },
  { code: "TUN", name: "Tunisia", lat: 33.8869, lng: 9.5375 },
  { code: "DZA", name: "Algeria", lat: 28.0339, lng: 1.6596 },
  { code: "CMR", name: "Cameroon", lat: 7.3697, lng: 12.3547 },
  { code: "CIV", name: "Côte d'Ivoire", lat: 7.54, lng: -5.5471 },
  { code: "SEN", name: "Senegal", lat: 14.4974, lng: -14.4524 },
  { code: "MLI", name: "Mali", lat: 17.5707, lng: -3.9962 },
  { code: "BFA", name: "Burkina Faso", lat: 12.2383, lng: -1.5616 },
];

export default function ServiceZones() {
  const [countries, setCountries] = useState<SupportedCountry[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedCountry, setSelectedCountry] = useState("");

  useEffect(() => {
    fetchCountries();
  }, []);

  async function fetchCountries() {
    try {
      const { data, error } = await supabase
        .from("supported_countries")
        .select("*")
        .order("country_name");

      if (error) {
        console.error("Error loading countries:", error);
        toast.error(`Failed to load countries: ${error.message}`);
        setLoading(false);
        return;
      }

      setCountries(data || []);
    } catch (err) {
      console.error("Unexpected error:", err);
      toast.error("Failed to load countries");
    } finally {
      setLoading(false);
    }
  }

  async function addCountry() {
    const country = AFRICAN_COUNTRIES.find((c) => c.code === selectedCountry);
    if (!country) {
      toast.error("Please select a country");
      return;
    }

    // Check if already exists
    if (countries.some((c) => c.country_code === country.code)) {
      toast.error("Country already added");
      return;
    }

    const { error } = await supabase.from("supported_countries").insert({
      country_code: country.code,
      country_name: country.name,
      latitude: country.lat,
      longitude: country.lng,
      is_active: true,
    });

    if (error) {
      toast.error("Failed to add country");
      return;
    }

    toast.success(`${country.name} added successfully`);
    setDialogOpen(false);
    setSelectedCountry("");
    fetchCountries();
  }

  async function toggleActive(id: string, isActive: boolean) {
    const { error } = await supabase
      .from("supported_countries")
      .update({ is_active: isActive })
      .eq("id", id);

    if (error) {
      toast.error("Failed to update status");
      return;
    }

    setCountries((prev) =>
      prev.map((c) => (c.id === id ? { ...c, is_active: isActive } : c))
    );
    toast.success("Status updated");
  }

  async function deleteCountry(id: string, name: string) {
    if (!confirm(`Remove ${name} from service zones?`)) return;

    const { error } = await supabase
      .from("supported_countries")
      .delete()
      .eq("id", id);

    if (error) {
      toast.error("Failed to delete country");
      return;
    }

    toast.success(`${name} removed`);
    fetchCountries();
  }

  const availableCountries = AFRICAN_COUNTRIES.filter(
    (c) => !countries.some((sc) => sc.country_code === c.code)
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Globe className="w-6 h-6" />
            Service Zones
          </h1>
          <p className="text-muted-foreground mt-1">
            Manage countries where AfriShop delivers
          </p>
        </div>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              Add Country
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Service Zone</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Select Country</Label>
                <Select value={selectedCountry} onValueChange={setSelectedCountry}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a country..." />
                  </SelectTrigger>
                  <SelectContent>
                    {availableCountries.map((country) => (
                      <SelectItem key={country.code} value={country.code}>
                        {country.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={addCountry} className="w-full">
                Add Country
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="bg-card rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Country</TableHead>
              <TableHead>Code</TableHead>
              <TableHead>Coordinates</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Added</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8">
                  Loading...
                </TableCell>
              </TableRow>
            ) : countries.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  No service zones configured. Add your first country above.
                </TableCell>
              </TableRow>
            ) : (
              countries.map((country) => (
                <TableRow key={country.id}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      <MapPin className="w-4 h-4 text-emerald-500" />
                      {country.country_name}
                    </div>
                  </TableCell>
                  <TableCell>
                    <code className="bg-muted px-2 py-1 rounded text-sm">
                      {country.country_code}
                    </code>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {country.latitude.toFixed(4)}, {country.longitude.toFixed(4)}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={country.is_active}
                        onCheckedChange={(checked) =>
                          toggleActive(country.id, checked)
                        }
                      />
                      <span
                        className={
                          country.is_active
                            ? "text-emerald-500 text-sm"
                            : "text-muted-foreground text-sm"
                        }
                      >
                        {country.is_active ? "Active" : "Inactive"}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {new Date(country.created_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        deleteCountry(country.id, country.country_name)
                      }
                    >
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
