import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Save } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";

const phoneNumberSchema = z.string()
  .trim()
  .max(20, { message: "Phone number must be less than 20 characters" })
  .regex(/^$|^[\d\s\+\-\(\)]+$/, { message: "Phone number can only contain digits, spaces, +, -, (, )" })
  .optional()
  .or(z.literal(""));

const paymentSettingsSchema = z.object({
  airtel_money_number: phoneNumberSchema,
  m_pesa_number: phoneNumberSchema,
  orange_money_number: phoneNumberSchema,
  afrimoney_number: phoneNumberSchema,
  payment_instructions: z.string().trim().max(1000, { message: "Instructions must be less than 1000 characters" }).optional().or(z.literal("")),
});

type PaymentSettingsFormData = z.infer<typeof paymentSettingsSchema>;

export default function PaymentSettings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const form = useForm<PaymentSettingsFormData>({
    resolver: zodResolver(paymentSettingsSchema),
    defaultValues: {
      airtel_money_number: "",
      m_pesa_number: "",
      orange_money_number: "",
      afrimoney_number: "",
      payment_instructions: "",
    },
  });

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

  // Update form when session data loads
  useEffect(() => {
    if (session) {
      form.reset({
        airtel_money_number: session.airtel_money_number || "",
        m_pesa_number: session.m_pesa_number || "",
        orange_money_number: session.orange_money_number || "",
        afrimoney_number: session.afrimoney_number || "",
        payment_instructions: session.payment_instructions || "",
      });
    }
  }, [session, form]);

  // Update session mutation
  const updateSettingsMutation = useMutation({
    mutationFn: async (data: PaymentSettingsFormData) => {
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

  const onSubmit = (data: PaymentSettingsFormData) => {
    updateSettingsMutation.mutate(data);
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

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Mobile Money Numbers</CardTitle>
              <CardDescription>
                Enter the phone numbers where applicants should send payments
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="airtel_money_number"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Airtel Money Number</FormLabel>
                    <FormControl>
                      <Input
                        type="tel"
                        placeholder="+243 812 345 678"
                        maxLength={20}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="m_pesa_number"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>M-Pesa Number</FormLabel>
                    <FormControl>
                      <Input
                        type="tel"
                        placeholder="+254 712 345 678"
                        maxLength={20}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="orange_money_number"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Orange Money Number</FormLabel>
                    <FormControl>
                      <Input
                        type="tel"
                        placeholder="+243 812 345 678"
                        maxLength={20}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="afrimoney_number"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Afrimoney Number</FormLabel>
                    <FormControl>
                      <Input
                        type="tel"
                        placeholder="+243 812 345 678"
                        maxLength={20}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
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
              <FormField
                control={form.control}
                name="payment_instructions"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <Textarea
                        placeholder="e.g., Please include your project code in the payment reference..."
                        rows={5}
                        maxLength={1000}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
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
      </Form>
    </div>
  );
}
