import { useState, useEffect } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
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
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Package, AlertTriangle } from "lucide-react";

interface ShippingItemType {
  id: string;
  key: string;
  label: string;
  description: string | null;
  est_weight_kg: number;
  requires_manual_quote: boolean;
  active: boolean;
  created_at: string;
  updated_at: string;
}

const HEAVY_THRESHOLD_KG = 9;

export default function ShippingTypes() {
  const { language } = useLanguage();
  const [types, setTypes] = useState<ShippingItemType[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingType, setEditingType] = useState<ShippingItemType | null>(null);
  const [formData, setFormData] = useState({
    key: "",
    label: "",
    description: "",
    est_weight_kg: "",
    requires_manual_quote: false,
    active: true,
  });

  const loadTypes = async () => {
    const { data, error } = await supabase
      .from("shipping_item_types")
      .select("*")
      .order("label");

    if (error) {
      toast.error("Failed to load shipping types");
      console.error(error);
    } else {
      setTypes(data || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadTypes();
  }, []);

  const resetForm = () => {
    setFormData({
      key: "",
      label: "",
      description: "",
      est_weight_kg: "",
      requires_manual_quote: false,
      active: true,
    });
    setEditingType(null);
  };

  const openAddDialog = () => {
    resetForm();
    setDialogOpen(true);
  };

  const openEditDialog = (type: ShippingItemType) => {
    setEditingType(type);
    setFormData({
      key: type.key,
      label: type.label,
      description: type.description || "",
      est_weight_kg: type.est_weight_kg.toString(),
      requires_manual_quote: type.requires_manual_quote,
      active: type.active,
    });
    setDialogOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const weight = parseFloat(formData.est_weight_kg);
    if (isNaN(weight) || weight <= 0) {
      toast.error("Please enter a valid weight");
      return;
    }

    const payload = {
      key: formData.key.toLowerCase().replace(/\s+/g, "_"),
      label: formData.label,
      description: formData.description || null,
      est_weight_kg: weight,
      requires_manual_quote: formData.requires_manual_quote || weight > HEAVY_THRESHOLD_KG,
      active: formData.active,
    };

    if (editingType) {
      const { error } = await supabase
        .from("shipping_item_types")
        .update(payload)
        .eq("id", editingType.id);

      if (error) {
        toast.error("Failed to update shipping type");
        console.error(error);
      } else {
        toast.success("Shipping type updated");
        setDialogOpen(false);
        loadTypes();
      }
    } else {
      const { error } = await supabase
        .from("shipping_item_types")
        .insert(payload);

      if (error) {
        toast.error("Failed to create shipping type");
        console.error(error);
      } else {
        toast.success("Shipping type created");
        setDialogOpen(false);
        loadTypes();
      }
    }
  };

  const toggleActive = async (type: ShippingItemType) => {
    const { error } = await supabase
      .from("shipping_item_types")
      .update({ active: !type.active })
      .eq("id", type.id);

    if (error) {
      toast.error("Failed to update status");
    } else {
      toast.success(type.active ? "Type deactivated" : "Type activated");
      loadTypes();
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Package className="h-6 w-6" />
            Shipping Item Types
          </h1>
          <p className="text-muted-foreground mt-1">
            Manage item categories for shipping weight estimation
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={openAddDialog}>
              <Plus className="h-4 w-4 mr-2" />
              Add Type
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>
                {editingType ? "Edit Shipping Type" : "Add Shipping Type"}
              </DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="key">Key (internal)</Label>
                <Input
                  id="key"
                  value={formData.key}
                  onChange={(e) => setFormData({ ...formData, key: e.target.value })}
                  placeholder="laptop_tablet"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="label">Label (user-facing)</Label>
                <Input
                  id="label"
                  value={formData.label}
                  onChange={(e) => setFormData({ ...formData, label: e.target.value })}
                  placeholder="Laptop / Tablet"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Description (examples)</Label>
                <Textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="MacBook, Chromebook, iPad, Surface"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="weight">Estimated Weight (kg)</Label>
                <Input
                  id="weight"
                  type="number"
                  step="0.1"
                  min="0.1"
                  value={formData.est_weight_kg}
                  onChange={(e) => setFormData({ ...formData, est_weight_kg: e.target.value })}
                  placeholder="2.5"
                  required
                />
                {parseFloat(formData.est_weight_kg) > HEAVY_THRESHOLD_KG && (
                  <p className="text-xs text-amber-500 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    Weight exceeds {HEAVY_THRESHOLD_KG}kg - will require manual quote
                  </p>
                )}
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="manual_quote">Always requires manual quote</Label>
                <Switch
                  id="manual_quote"
                  checked={formData.requires_manual_quote}
                  onCheckedChange={(checked) => setFormData({ ...formData, requires_manual_quote: checked })}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="active">Active</Label>
                <Switch
                  id="active"
                  checked={formData.active}
                  onCheckedChange={(checked) => setFormData({ ...formData, active: checked })}
                />
              </div>
              <div className="flex justify-end gap-2 pt-4">
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit">
                  {editingType ? "Update" : "Create"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Label</TableHead>
              <TableHead>Key</TableHead>
              <TableHead className="text-right">Weight (kg)</TableHead>
              <TableHead className="text-center">Manual Quote</TableHead>
              <TableHead className="text-center">Status</TableHead>
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
            ) : types.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  No shipping types configured
                </TableCell>
              </TableRow>
            ) : (
              types.map((type) => (
                <TableRow key={type.id} className={!type.active ? "opacity-50" : ""}>
                  <TableCell>
                    <div>
                      <div className="font-medium">{type.label}</div>
                      {type.description && (
                        <div className="text-xs text-muted-foreground">{type.description}</div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-sm">{type.key}</TableCell>
                  <TableCell className="text-right">
                    {type.est_weight_kg} kg
                    {type.est_weight_kg > HEAVY_THRESHOLD_KG && (
                      <AlertTriangle className="h-3 w-3 text-amber-500 inline ml-1" />
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    {type.requires_manual_quote ? (
                      <Badge variant="secondary">Yes</Badge>
                    ) : (
                      <span className="text-muted-foreground">No</span>
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge variant={type.active ? "default" : "outline"}>
                      {type.active ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => openEditDialog(type)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant={type.active ? "outline" : "default"}
                        onClick={() => toggleActive(type)}
                      >
                        {type.active ? "Deactivate" : "Activate"}
                      </Button>
                    </div>
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
