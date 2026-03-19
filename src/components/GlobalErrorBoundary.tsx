import { Component, type ReactNode } from "react";
import { recoverFromStaleBundle } from "@/lib/cacheBust";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

const isRecoverableContextError = (error: Error): boolean => {
  const message = error?.message || "";
  return (
    message.includes("useAuth must be used within AuthProvider") ||
    message.includes("useShopCart must be used within a ShopCartProvider")
  );
};

export class GlobalErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[GlobalErrorBoundary]", error, info.componentStack);

    if (typeof window !== "undefined" && isRecoverableContextError(error)) {
      console.warn("[GlobalErrorBoundary] Recovering from stale bundle context mismatch");
      recoverFromStaleBundle();
    }
  }

  handleRetry = () => {
    this.setState({ hasError: false });
    recoverFromStaleBundle();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background p-6">
          <div className="text-center max-w-md space-y-4">
            <h1 className="text-2xl font-bold text-foreground">Something went wrong</h1>
            <p className="text-muted-foreground">
              An unexpected error occurred. Please try again.
            </p>
            <button
              onClick={this.handleRetry}
              className="px-6 py-2 bg-primary text-primary-foreground rounded-lg font-medium hover:opacity-90 transition-opacity"
            >
              Reload app
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
