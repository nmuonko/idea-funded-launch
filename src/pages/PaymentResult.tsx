import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, Home, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export default function PaymentResult() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [projectCode, setProjectCode] = useState<string | null>(null);

  const status = searchParams.get("status") ?? "";
  const description = searchParams.get("description") ?? "";
  const transactionRefId = searchParams.get("transactionRefId") ?? "";
  const operatorRefId = searchParams.get("operatorRefId") ?? "";
  const submissionId = searchParams.get("submissionId") ?? "";

  // Determine if payment was successful
  const normalizedStatus = status.toLowerCase();
  const isSuccess =
    normalizedStatus === "success" ||
    normalizedStatus === "paid" ||
    normalizedStatus === "1" ||
    normalizedStatus.includes("success");

  useEffect(() => {
    // Fetch submission details to get project code
    const fetchSubmission = async () => {
      if (!submissionId) {
        setLoading(false);
        return;
      }

      try {
        const { data, error } = await supabase
          .from("user_submissions")
          .select("project_code")
          .eq("id", submissionId)
          .maybeSingle();

        if (error) {
          console.error("Error fetching submission:", error);
        } else if (data) {
          setProjectCode(data.project_code);
        }
      } catch (err) {
        console.error("Error in fetchSubmission:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchSubmission();
  }, [submissionId]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-2xl space-y-6">
        {/* Main Status Card */}
        <Card className={isSuccess ? "border-green-500" : "border-red-500"}>
          <CardHeader>
            <div className="flex items-center gap-3">
              {isSuccess ? (
                <CheckCircle2 className="h-8 w-8 text-green-500" />
              ) : (
                <XCircle className="h-8 w-8 text-red-500" />
              )}
              <div>
                <CardTitle className={isSuccess ? "text-green-700" : "text-red-700"}>
                  {isSuccess ? "Payment Successful!" : "Payment Failed"}
                </CardTitle>
                <CardDescription>
                  {isSuccess
                    ? "Thank you for joining AfriFund's competition."
                    : "Your payment could not be processed."}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {isSuccess ? (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  Your application has been received and is now under review. You will receive updates via email.
                </p>
                {projectCode && (
                  <div className="p-3 bg-green-50 dark:bg-green-950 rounded-lg">
                    <p className="text-sm font-medium text-green-900 dark:text-green-100">
                      Your Project Code: <span className="font-bold">{projectCode}</span>
                    </p>
                    <p className="text-xs text-green-700 dark:text-green-300 mt-1">
                      Save this code to track your application status
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {description || "The payment was cancelled or encountered an error. Please try again or contact support if the problem persists."}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Payment Details Card */}
        {(transactionRefId || operatorRefId || status) && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Payment Details</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 text-sm">
                {status && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Status:</span>
                    <span className="font-medium">{status}</span>
                  </div>
                )}
                {description && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Description:</span>
                    <span className="font-medium">{description}</span>
                  </div>
                )}
                {transactionRefId && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Transaction ID:</span>
                    <span className="font-mono text-xs">{transactionRefId}</span>
                  </div>
                )}
                {operatorRefId && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Operator Reference:</span>
                    <span className="font-mono text-xs">{operatorRefId}</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Next Steps Card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {isSuccess ? "What's Next?" : "What Should You Do?"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {isSuccess ? (
              <>
                <p className="text-sm text-muted-foreground">
                  1. Check your email for a payment confirmation
                </p>
                <p className="text-sm text-muted-foreground">
                  2. Our team will review your application
                </p>
                <p className="text-sm text-muted-foreground">
                  3. Track your application status using your project code
                </p>
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  1. Verify your payment details
                </p>
                <p className="text-sm text-muted-foreground">
                  2. Try the payment again
                </p>
                <p className="text-sm text-muted-foreground">
                  3. Contact support if issues persist
                </p>
              </>
            )}
          </CardContent>
        </Card>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-3">
          <Button
            onClick={() => navigate("/")}
            variant="outline"
            className="flex-1"
          >
            <Home className="mr-2 h-4 w-4" />
            Back to Home
          </Button>
          {isSuccess && projectCode ? (
            <Button
              onClick={() => navigate("/results")}
              className="flex-1"
            >
              <Search className="mr-2 h-4 w-4" />
              Track Application
            </Button>
          ) : (
            <Button
              onClick={() => navigate("/apply")}
              className="flex-1"
            >
              Try Again
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}