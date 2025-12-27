import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Copy, Check, Building2, Edit2, Save, X, Phone, Mail, Loader2, AlertCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface BankDetails {
  bank_name: string | null;
  bank_account_holder: string | null;
  bank_account_number: string | null;
  bank_swift: string | null;
  bank_iban: string | null;
  bank_address: string | null;
  bank_instructions_fr: string | null;
  bank_instructions_en: string | null;
  support_whatsapp: string | null;
  support_email: string | null;
}

export default function BankTransferInfo() {
  const { isAdmin, loading: authLoading } = useAuth();
  const [details, setDetails] = useState<BankDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editedDetails, setEditedDetails] = useState<BankDetails | null>(null);
  const [language, setLanguage] = useState<'fr' | 'en'>('fr');
  const [copiedField, setCopiedField] = useState<string | null>(null);

  useEffect(() => {
    fetchBankDetails();
  }, []);

  const fetchBankDetails = async () => {
    try {
      const { data, error } = await supabase
        .from('settings')
        .select('bank_name, bank_account_holder, bank_account_number, bank_swift, bank_iban, bank_address, bank_instructions_fr, bank_instructions_en, support_whatsapp, support_email')
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error('Error fetching bank details:', error);
        toast.error('Failed to load bank details');
        return;
      }

      setDetails(data);
      setEditedDetails(data);
    } catch (err) {
      console.error('Exception fetching bank details:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!editedDetails) return;

    setSaving(true);
    try {
      const { error } = await supabase
        .from('settings')
        .update({
          bank_name: editedDetails.bank_name,
          bank_account_holder: editedDetails.bank_account_holder,
          bank_account_number: editedDetails.bank_account_number,
          bank_swift: editedDetails.bank_swift,
          bank_iban: editedDetails.bank_iban,
          bank_address: editedDetails.bank_address,
          bank_instructions_fr: editedDetails.bank_instructions_fr,
          bank_instructions_en: editedDetails.bank_instructions_en,
          support_whatsapp: editedDetails.support_whatsapp,
          support_email: editedDetails.support_email,
        })
        .eq('id', (await supabase.from('settings').select('id').limit(1).single()).data?.id);

      if (error) {
        console.error('Error saving bank details:', error);
        toast.error('Failed to save bank details');
        return;
      }

      setDetails(editedDetails);
      setEditMode(false);
      toast.success(language === 'fr' ? 'Détails bancaires enregistrés' : 'Bank details saved');
    } catch (err) {
      console.error('Exception saving bank details:', err);
      toast.error('An error occurred');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setEditedDetails(details);
    setEditMode(false);
  };

  const copyToClipboard = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      toast.success(language === 'fr' ? 'Copié!' : 'Copied!');
      setTimeout(() => setCopiedField(null), 2000);
    } catch (err) {
      toast.error('Failed to copy');
    }
  };

  const updateField = (field: keyof BankDetails, value: string) => {
    if (!editedDetails) return;
    setEditedDetails({ ...editedDetails, [field]: value });
  };

  const missingCriticalInfo = !details?.bank_account_number || !details?.bank_swift;

  if (loading || authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const DetailRow = ({ label, value, field }: { label: string; value: string | null; field: string }) => (
    <div className="flex items-center justify-between py-3 border-b border-border last:border-0">
      <div>
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="font-medium text-foreground">{value || '-'}</p>
      </div>
      {value && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => copyToClipboard(value, field)}
          className="h-8 w-8 p-0"
        >
          {copiedField === field ? (
            <Check className="h-4 w-4 text-green-500" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
        </Button>
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-background py-8 px-4">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-lg">
              <Building2 className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">
                {language === 'fr' ? 'Informations Bancaires' : 'Bank Transfer Information'}
              </h1>
              <p className="text-sm text-muted-foreground">
                {language === 'fr' ? 'Détails pour effectuer un virement' : 'Details for making a bank transfer'}
              </p>
            </div>
          </div>
          
          {/* Language Toggle */}
          <div className="flex items-center gap-2">
            <Button
              variant={language === 'fr' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setLanguage('fr')}
            >
              FR
            </Button>
            <Button
              variant={language === 'en' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setLanguage('en')}
            >
              EN
            </Button>
          </div>
        </div>

        {/* Admin Edit Button */}
        {isAdmin && !editMode && (
          <Button onClick={() => setEditMode(true)} variant="outline" className="gap-2">
            <Edit2 className="h-4 w-4" />
            {language === 'fr' ? 'Modifier' : 'Edit'}
          </Button>
        )}

        {/* Admin Edit Actions */}
        {isAdmin && editMode && (
          <div className="flex gap-2">
            <Button onClick={handleSave} disabled={saving} className="gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {language === 'fr' ? 'Enregistrer' : 'Save'}
            </Button>
            <Button onClick={handleCancel} variant="outline" disabled={saving} className="gap-2">
              <X className="h-4 w-4" />
              {language === 'fr' ? 'Annuler' : 'Cancel'}
            </Button>
          </div>
        )}

        {/* Missing Info Warning */}
        {missingCriticalInfo && !editMode && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {language === 'fr' 
                ? 'Les informations bancaires sont incomplètes. Veuillez contacter le support.' 
                : 'Bank information is incomplete. Please contact support.'}
            </AlertDescription>
          </Alert>
        )}

        {/* Bank Details Card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              {language === 'fr' ? 'Détails Bancaires' : 'Bank Details'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {editMode && editedDetails ? (
              <div className="space-y-4">
                <div>
                  <Label>{language === 'fr' ? 'Nom de la Banque' : 'Bank Name'}</Label>
                  <Input
                    value={editedDetails.bank_name || ''}
                    onChange={(e) => updateField('bank_name', e.target.value)}
                    placeholder="e.g., Rawbank"
                  />
                </div>
                <div>
                  <Label>{language === 'fr' ? 'Titulaire du Compte' : 'Account Holder'}</Label>
                  <Input
                    value={editedDetails.bank_account_holder || ''}
                    onChange={(e) => updateField('bank_account_holder', e.target.value)}
                    placeholder="e.g., AfriShop USA LLC"
                  />
                </div>
                <div>
                  <Label>{language === 'fr' ? 'Numéro de Compte' : 'Account Number'}</Label>
                  <Input
                    value={editedDetails.bank_account_number || ''}
                    onChange={(e) => updateField('bank_account_number', e.target.value)}
                    placeholder="Account number"
                  />
                </div>
                <div>
                  <Label>SWIFT / BIC</Label>
                  <Input
                    value={editedDetails.bank_swift || ''}
                    onChange={(e) => updateField('bank_swift', e.target.value)}
                    placeholder="e.g., RAWBCDKI"
                  />
                </div>
                <div>
                  <Label>IBAN ({language === 'fr' ? 'optionnel' : 'optional'})</Label>
                  <Input
                    value={editedDetails.bank_iban || ''}
                    onChange={(e) => updateField('bank_iban', e.target.value)}
                    placeholder="IBAN"
                  />
                </div>
                <div>
                  <Label>{language === 'fr' ? 'Adresse de la Banque' : 'Bank Address'} ({language === 'fr' ? 'optionnel' : 'optional'})</Label>
                  <Textarea
                    value={editedDetails.bank_address || ''}
                    onChange={(e) => updateField('bank_address', e.target.value)}
                    placeholder="Bank address"
                    rows={2}
                  />
                </div>
              </div>
            ) : (
              <div>
                <DetailRow 
                  label={language === 'fr' ? 'Banque' : 'Bank'} 
                  value={details?.bank_name} 
                  field="bank_name" 
                />
                <DetailRow 
                  label={language === 'fr' ? 'Titulaire' : 'Account Holder'} 
                  value={details?.bank_account_holder} 
                  field="account_holder" 
                />
                <DetailRow 
                  label={language === 'fr' ? 'Numéro de Compte' : 'Account Number'} 
                  value={details?.bank_account_number} 
                  field="account_number" 
                />
                <DetailRow 
                  label="SWIFT / BIC" 
                  value={details?.bank_swift} 
                  field="swift" 
                />
                {details?.bank_iban && (
                  <DetailRow label="IBAN" value={details?.bank_iban} field="iban" />
                )}
                {details?.bank_address && (
                  <DetailRow 
                    label={language === 'fr' ? 'Adresse' : 'Address'} 
                    value={details?.bank_address} 
                    field="address" 
                  />
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Instructions Card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              {language === 'fr' ? 'Instructions' : 'Instructions'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {editMode && editedDetails ? (
              <div className="space-y-4">
                <div>
                  <Label>Instructions (Français)</Label>
                  <Textarea
                    value={editedDetails.bank_instructions_fr || ''}
                    onChange={(e) => updateField('bank_instructions_fr', e.target.value)}
                    rows={3}
                    placeholder="Instructions en français..."
                  />
                </div>
                <div>
                  <Label>Instructions (English)</Label>
                  <Textarea
                    value={editedDetails.bank_instructions_en || ''}
                    onChange={(e) => updateField('bank_instructions_en', e.target.value)}
                    rows={3}
                    placeholder="Instructions in English..."
                  />
                </div>
              </div>
            ) : (
              <p className="text-foreground whitespace-pre-wrap">
                {language === 'fr' 
                  ? details?.bank_instructions_fr || 'Veuillez effectuer le virement bancaire en utilisant la référence de commande indiquée.'
                  : details?.bank_instructions_en || 'Please make the bank transfer using the order reference indicated.'}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Support Contact Card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              {language === 'fr' ? 'Besoin d\'aide?' : 'Need Help?'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {editMode && editedDetails ? (
              <div className="space-y-4">
                <div>
                  <Label>WhatsApp</Label>
                  <Input
                    value={editedDetails.support_whatsapp || ''}
                    onChange={(e) => updateField('support_whatsapp', e.target.value)}
                    placeholder="+1-XXX-XXX-XXXX"
                  />
                </div>
                <div>
                  <Label>Email</Label>
                  <Input
                    value={editedDetails.support_email || ''}
                    onChange={(e) => updateField('support_email', e.target.value)}
                    placeholder="support@example.com"
                  />
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-3">
                {details?.support_whatsapp && (
                  <Button
                    variant="outline"
                    className="gap-2"
                    onClick={() => window.open(`https://wa.me/${details.support_whatsapp?.replace(/[^0-9+]/g, '')}`, '_blank')}
                  >
                    <Phone className="h-4 w-4" />
                    WhatsApp
                  </Button>
                )}
                {details?.support_email && (
                  <Button
                    variant="outline"
                    className="gap-2"
                    onClick={() => window.open(`mailto:${details.support_email}`, '_blank')}
                  >
                    <Mail className="h-4 w-4" />
                    Email
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
