import { Component, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ProductDetailErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    const route = typeof window !== 'undefined' ? window.location.pathname : 'unknown';
    console.error('[ProductDetailErrorBoundary] Caught rendering error', {
      message: error.message,
      route,
      stack: error.stack?.slice(0, 500),
      componentStack: errorInfo.componentStack?.slice(0, 300),
    });
  }

  handleReload = () => {
    this.setState({ hasError: false, error: undefined });
    window.location.reload();
  };

  handleBack = () => {
    this.setState({ hasError: false, error: undefined });
    window.location.href = '/';
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-black flex items-center justify-center px-4">
          <div className="bg-white/5 border border-white/10 rounded-2xl p-8 text-center max-w-md w-full">
            <AlertTriangle className="h-12 w-12 text-yellow-400 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-white mb-2">Something went wrong</h2>
            <p className="text-white/60 text-sm mb-6">
              We couldn't load this product. Please try again.
            </p>
            <div className="flex flex-col gap-3">
              <Button
                onClick={this.handleReload}
                className="w-full bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600"
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Reload
              </Button>
              <Button
                variant="outline"
                onClick={this.handleBack}
                className="w-full border-white/20 text-white hover:bg-white/10"
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to results
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
