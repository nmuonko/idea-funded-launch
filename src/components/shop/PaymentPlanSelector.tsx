import { Wallet, Banknote, Info } from 'lucide-react';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { formatCurrency } from '@/lib/formatCurrency';

export type PaymentPlan = 'full' | 'deposit';

interface Props {
  value: PaymentPlan;
  onChange: (plan: PaymentPlan) => void;
  totalUsd: number;
  language: string;
  /** When false, only the "Pay in full" option is shown (no deposit toggle). */
  eligible: boolean;
  /** Reason why deposit is unavailable, shown as a small hint when !eligible. */
  ineligibleReason?: string;
}

/**
 * Lets the customer choose between paying the full amount now or a 30% deposit
 * with the remaining 70% due on arrival. Cars and orders under $100 are excluded
 * (controlled via the `eligible` prop computed by the parent).
 */
export function PaymentPlanSelector({ value, onChange, totalUsd, language, eligible, ineligibleReason }: Props) {
  const isFr = language === 'fr';
  const deposit = Math.ceil(totalUsd * 0.30 * 100) / 100;
  const balance = Math.ceil((totalUsd - deposit) * 100) / 100;

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
      <h3 className="text-base font-semibold text-white">
        {isFr ? 'Plan de paiement' : 'Payment plan'}
      </h3>
      <p className="text-xs text-white/50 mt-1">
        {isFr
          ? 'Choisissez de payer maintenant ou en deux fois.'
          : 'Choose to pay now or in two parts.'}
      </p>

      <RadioGroup
        value={eligible ? value : 'full'}
        onValueChange={(v) => onChange(v as PaymentPlan)}
        className="mt-4 space-y-3"
      >
        <label className="flex items-start gap-4 p-4 rounded-xl border border-white/10 cursor-pointer hover:bg-white/5 transition-colors">
          <RadioGroupItem value="full" id="plan-full" className="border-white/40 mt-1" />
          <Banknote className="h-5 w-5 text-white/70 mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-white font-medium">
                {isFr ? 'Payer la totalité maintenant' : 'Pay in full now'}
              </p>
              <p className="text-white font-semibold">{formatCurrency(totalUsd, { currency: 'USD' })}</p>
            </div>
            <p className="text-xs text-white/50 mt-1">
              {isFr ? 'Paiement unique.' : 'Single payment.'}
            </p>
          </div>
        </label>

        <label
          className={`flex items-start gap-4 p-4 rounded-xl border transition-colors ${
            eligible
              ? 'border-white/10 cursor-pointer hover:bg-white/5'
              : 'border-white/5 opacity-50 cursor-not-allowed'
          }`}
        >
          <RadioGroupItem
            value="deposit"
            id="plan-deposit"
            disabled={!eligible}
            className="border-white/40 mt-1"
          />
          <Wallet className="h-5 w-5 text-white/70 mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-white font-medium">
                {isFr ? 'Acompte 30% maintenant, 70% à l’arrivée' : 'Pay 30% deposit now, 70% on arrival'}
              </p>
              <p className="text-white font-semibold">{formatCurrency(deposit, { currency: 'USD' })}</p>
            </div>
            <p className="text-xs text-white/50 mt-1">
              {isFr
                ? `Solde de ${formatCurrency(balance, { currency: 'USD' })} dû lorsque vos articles arrivent.`
                : `Remaining ${formatCurrency(balance, { currency: 'USD' })} due when your items arrive.`}
            </p>
            {!eligible && ineligibleReason && (
              <p className="text-xs text-amber-300/80 mt-2 flex items-center gap-1">
                <Info className="h-3 w-3" />
                {ineligibleReason}
              </p>
            )}
          </div>
        </label>
      </RadioGroup>
    </div>
  );
}
