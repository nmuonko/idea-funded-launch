import { useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Loader2, AlertTriangle } from 'lucide-react';

interface ResetSectionDialogProps {
  section: 'orders' | 'payments' | 'carts' | 'tickets' | 'order_actions';
  sectionLabel: string;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function ResetSectionDialog({ 
  section, 
  sectionLabel, 
  open, 
  onClose, 
  onSuccess 
}: ResetSectionDialogProps) {
  const [confirmationText, setConfirmationText] = useState('');
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const expectedText = `DELETE ALL ${section.toUpperCase()}`;

  const handleReset = async () => {
    if (confirmationText !== expectedText) {
      toast({
        title: 'Invalid confirmation',
        description: `Please type "${expectedText}" exactly to confirm`,
        variant: 'destructive',
      });
      return;
    }

    try {
      setLoading(true);

      const { data, error } = await supabase.functions.invoke('admin-service', {
        body: { action: 'reset_section', section, confirmationText }
      });

      if (error) throw error;

      toast({
        title: 'Section Reset',
        description: data.message,
      });

      setConfirmationText('');
      onSuccess();
      onClose();
    } catch (error: any) {
      toast({
        title: 'Reset Failed',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setConfirmationText('');
    onClose();
  };

  return (
    <AlertDialog open={open} onOpenChange={handleClose}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            Reset {sectionLabel}
          </AlertDialogTitle>
          <AlertDialogDescription className="space-y-3">
            <p>
              This action will <strong>permanently delete ALL {sectionLabel.toLowerCase()}</strong> from the database. 
              This cannot be undone.
            </p>
            <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3 text-sm">
              <p className="font-medium text-destructive">Warning:</p>
              <ul className="list-disc list-inside mt-1 text-muted-foreground">
                <li>All {sectionLabel.toLowerCase()} will be permanently deleted</li>
                <li>Related data (items, actions, messages) will also be deleted</li>
                <li>This action is logged for audit purposes</li>
              </ul>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="py-4">
          <Label htmlFor="confirmation" className="text-sm">
            Type <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">{expectedText}</code> to confirm:
          </Label>
          <Input
            id="confirmation"
            value={confirmationText}
            onChange={(e) => setConfirmationText(e.target.value)}
            placeholder={expectedText}
            className="mt-2 font-mono"
            disabled={loading}
          />
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleReset}
            disabled={loading || confirmationText !== expectedText}
            className="bg-destructive hover:bg-destructive/90"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Deleting...
              </>
            ) : (
              'Delete All'
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
