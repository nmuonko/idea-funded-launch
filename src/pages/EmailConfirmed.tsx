import afrishopLogo from "@/assets/afrishop-logo.png";

const EmailConfirmed = () => {
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
    </div>
  );
};

export default EmailConfirmed;
