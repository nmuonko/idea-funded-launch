import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Save } from "lucide-react";

export default function PaymentSettings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch active session
  const { data: session, isLoading } = useQuery({
    queryKey: ["activeSession"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sessions")
        .select("*")
        .eq("status", "open")
        .maybeSingle();

      if (error) throw error;
      return data;
    },
  });

  const [formData, setFormData] = useState({
    airtel_money_number: session?.airtel_money_number || "",
    m_pesa_number: session?.m_pesa_number || "",
    orange_money_number: session?.orange_money_number || "",
    afrimoney_number: session?.afrimoney_number || "",
    payment_instructions: session?.payment_instructions || "",
  });

  // Update session mutation
  const updateSettingsMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      if (!session) throw new Error("No active session");

      const { error } = await supabase
        .from("sessions")
        .update(data)
        .eq("id", session.id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["activeSession"] });
      toast({
        title: "Settings Updated",
        description: "Payment settings have been saved successfully.",
      });
    },
    onError: (error) => {
      toast({
        title: "Update Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateSettingsMutation.mutate(formData);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardHeader>
            <CardTitle>No Active Session</CardTitle>
            <CardDescription>
              Please create and activate a session before configuring payment settings.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Payment Settings</h1>
        <p className="text-muted-foreground">
          Configure mobile money payment options for {session.name}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Mobile Money Numbers</CardTitle>
            <CardDescription>
              Enter the phone numbers where applicants should send payments
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="airtel">Airtel Money Number</Label>
              <Input
                id="airtel"
                type="tel"
                placeholder="+243 812 345 678"
                value={formData.airtel_money_number}
                onChange={(e) =>
                  setFormData({ ...formData, airtel_money_number: e.target.value })
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="mpesa">M-Pesa Number</Label>
              <Input
                id="mpesa"
                type="tel"
                placeholder="+254 712 345 678"
                value={formData.m_pesa_number}
                onChange={(e) =>
                  setFormData({ ...formData, m_pesa_number: e.target.value })
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="orange">Orange Money Number</Label>
              <Input
                id="orange"
                type="tel"
                placeholder="+243 812 345 678"
                value={formData.orange_money_number}
                onChange={(e) =>
                  setFormData({ ...formData, orange_money_number: e.target.value })
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="afrimoney">Afrimoney Number</Label>
              <Input
                id="afrimoney"
                type="tel"
                placeholder="+243 812 345 678"
                value={formData.afrimoney_number}
                onChange={(e) =>
                  setFormData({ ...formData, afrimoney_number: e.target.value })
                }
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Payment Instructions</CardTitle>
            <CardDescription>
              Additional instructions for applicants (optional)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Textarea
              placeholder="e.g., Please include your project code in the payment reference..."
              value={formData.payment_instructions}
              onChange={(e) =>
                setFormData({ ...formData, payment_instructions: e.target.value })
              }
              rows={5}
            />
          </CardContent>
        </Card>

        <Button
          type="submit"
          size="lg"
          disabled={updateSettingsMutation.isPending}
          className="w-full sm:w-auto"
        >
          {updateSettingsMutation.isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="mr-2 h-4 w-4" />
              Save Settings
            </>
          )}
        </Button>
      </form>
    </div>
  );
}
