import { Check, Clock, Trophy } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SessionProgressStepsProps {
  status: 'open' | 'closed' | 'results_published';
  deadlinePassed: boolean;
}

export default function SessionProgressSteps({ status, deadlinePassed }: SessionProgressStepsProps) {
  // Determine which step is active
  const currentStep = status === 'results_published' 
    ? 3 
    : deadlinePassed 
    ? 2 
    : 1;

  const steps = [
    {
      number: 1,
      title: 'Applications Open',
      icon: Clock,
      description: 'Accepting new applications',
    },
    {
      number: 2,
      title: 'Review in Progress',
      icon: Clock,
      description: 'Review process is in progress',
    },
    {
      number: 3,
      title: 'Results Published',
      icon: Trophy,
      description: 'Winners announced',
    },
  ];

  return (
    <div className="w-full py-8">
      <div className="flex items-center justify-between max-w-3xl mx-auto">
        {steps.map((step, index) => {
          const isActive = step.number === currentStep;
          const isCompleted = step.number < currentStep;
          const Icon = step.icon;

          return (
            <div key={step.number} className="flex items-center flex-1">
              {/* Step Circle */}
              <div className="flex flex-col items-center flex-1">
                <div
                  className={cn(
                    'w-12 h-12 rounded-full flex items-center justify-center border-2 transition-all',
                    isCompleted && 'bg-primary border-primary text-primary-foreground',
                    isActive && 'bg-primary border-primary text-primary-foreground shadow-glow',
                    !isActive && !isCompleted && 'bg-muted border-muted-foreground/20 text-muted-foreground'
                  )}
                >
                  {isCompleted ? (
                    <Check className="h-6 w-6" />
                  ) : (
                    <Icon className="h-6 w-6" />
                  )}
                </div>
                
                {/* Step Label */}
                <div className="mt-3 text-center">
                  <p
                    className={cn(
                      'text-sm font-semibold',
                      (isActive || isCompleted) ? 'text-foreground' : 'text-muted-foreground'
                    )}
                  >
                    {step.title}
                  </p>
                  {isActive && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {step.description}
                    </p>
                  )}
                </div>
              </div>

              {/* Connector Line */}
              {index < steps.length - 1 && (
                <div
                  className={cn(
                    'h-0.5 flex-1 mx-2 transition-all',
                    isCompleted ? 'bg-primary' : 'bg-muted'
                  )}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
