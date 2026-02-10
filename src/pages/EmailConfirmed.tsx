import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import afrishopLogo from "@/assets/afrishop-logo.png";
import { supabase } from "@/integrations/supabase/client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const EmailConfirmed = () => {
  const navigate = useNavigate();
  const [showPopup, setShowPopup] = useState(false);
  const [hasSession, setHasSession] = useState(false);

  useEffect(() => {
    // Listen for auth state changes — when verification link is clicked,
    // Supabase sets the session automatically via the URL hash/tokens
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (session?.user?.email_confirmed_at) {
          setHasSession(true);
          setShowPopup(true);
        }
      }
    );

    // Also check if there's already an active verified session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user?.email_confirmed_at) {
        setHasSession(true);
        setShowPopup(true);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleDismiss = () => {
    // Set sessionActive so AuthContext doesn't clear the session on the homepage
    sessionStorage.setItem('sessionActive', 'true');
    setShowPopup(false);
    navigate("/", { replace: true });
  };

  // If we have a session and popup is showing, render the popup over the confirmation page
  // Otherwise show the static page (for mobile app users who just need to close the tab)
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6">
      <div className="max-w-md w-full text-center space-y-8">
        {/* Logo */}
        <div className="flex justify-center">
          <img 
            src={afrishopLogo} 
            alt="AfriShop USA" 
            className="h-16 w-auto"
          />
        </div>

        {/* Success Icon */}
        <div className="flex justify-center">
          <div className="w-20 h-20 rounded-full bg-green-500/20 flex items-center justify-center">
            <svg 
              className="w-10 h-10 text-green-500" 
              fill="none" 
              stroke="currentColor" 
              viewBox="0 0 24 24"
            >
              <path 
                strokeLinecap="round" 
                strokeLinejoin="round" 
                strokeWidth={2} 
                d="M5 13l4 4L19 7" 
              />
            </svg>
          </div>
        </div>

        {/* Bilingual Title */}
        <h1 className="text-2xl md:text-3xl font-bold text-foreground">
          E-mail confirmé ✅
          <br />
          <span className="text-muted-foreground text-xl md:text-2xl">
            Email Confirmed ✅
          </span>
        </h1>

        {/* Bilingual Body */}
        <div className="space-y-4 text-muted-foreground">
          <p>
            Merci d'avoir vérifié votre adresse e-mail. Vous pouvez maintenant retourner dans l'application AfriShop et continuer votre paiement.
          </p>
          <p className="text-sm opacity-80">
            Thank you for verifying your email. You can now return to the AfriShop app and continue your checkout.
          </p>
        </div>

        {/* Safe to close message */}
        <div className="pt-4 border-t border-border">
          <p className="text-sm text-muted-foreground/70">
            Vous pouvez fermer cette page en toute sécurité.
            <br />
            <span className="text-xs">You may safely close this page.</span>
          </p>
        </div>
      </div>

      {/* Thank-you popup — only for web users with an active session */}
      <AlertDialog open={showPopup}>
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <div className="flex justify-center mb-4">
              <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center">
                <svg 
                  className="w-8 h-8 text-green-500" 
                  fill="none" 
                  stroke="currentColor" 
                  viewBox="0 0 24 24"
                >
                  <path 
                    strokeLinecap="round" 
                    strokeLinejoin="round" 
                    strokeWidth={2} 
                    d="M5 13l4 4L19 7" 
                  />
                </svg>
              </div>
            </div>
            <AlertDialogTitle className="text-center text-xl">
              Merci ! 🎉
              <br />
              <span className="text-base text-muted-foreground">Thank you!</span>
            </AlertDialogTitle>
            <AlertDialogDescription className="text-center space-y-2">
              <span className="block">
                Votre e-mail a été vérifié avec succès. Bienvenue sur AfriShop !
              </span>
              <span className="block text-sm opacity-80">
                Your email has been verified successfully. Welcome to AfriShop!
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="sm:justify-center">
            <AlertDialogAction 
              onClick={handleDismiss}
              className="w-full sm:w-auto bg-blue-600 hover:bg-blue-700 text-white"
            >
              OK — Commencer à explorer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default EmailConfirmed;
