import { useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { PaymentDialog } from '@/components/PaymentDialog';

import { z } from 'zod';

const applicationSchema = z.object({
  fullName: z.string().trim().min(1, 'Full name is required').max(200, 'Full name must be less than 200 characters'),
  whatsappNumber: z.string().trim().min(1, 'WhatsApp number is required').max(20, 'WhatsApp number must be less than 20 characters'),
  email: z.string().trim().email('Invalid email address').max(255, 'Email must be less than 255 characters'),
  cityProvince: z.string().trim().min(1, 'City/Province is required').max(100, 'City/Province must be less than 100 characters'),
  projectTitle: z.string().trim().min(1, 'Project title is required').max(100, 'Project title must be less than 100 characters'),
  projectDescription: z.string().trim().min(1, 'Project description is required').max(500, 'Project description must be less than 500 characters'),
  estimatedRevenue: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, 'Estimated revenue must be a positive number'),
  timeUntilProfit: z.string().min(1, 'Time until profit is required'),
  feasibilityExplanation: z.string().trim().min(1, 'Feasibility explanation is required').max(300, 'Feasibility explanation must be less than 300 characters'),
  fundingNeeded: z.string().refine((val) => ['500', '1000', '2000'].includes(val), 'Invalid funding amount'),
  willHire: z.string().refine((val) => ['yes', 'no'].includes(val), 'Please select yes or no'),
  numberOfHires: z.string().optional().refine((val) => !val || (!isNaN(parseInt(val)) && parseInt(val) >= 1), 'Number of hires must be at least 1'),
});

export default function Apply() {
  const { t } = useLanguage();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [submissionId, setSubmissionId] = useState<string>('');
  const [formData, setFormData] = useState({
    fullName: '',
    whatsappNumber: '',
    email: '',
    cityProvince: '',
    projectTitle: '',
    projectDescription: '',
    estimatedRevenue: '',
    timeUntilProfit: '',
    feasibilityExplanation: '',
    fundingNeeded: '',
    willHire: '',
    numberOfHires: '',
    agreements: {
      ownProject: false,
      ageConfirm: false,
      feeNonRefundable: false,
      agreeToRules: false,
    },
  });

  const descriptionMaxLength = 500;
  const feasibilityMaxLength = 300;

  // Fetch active session (direct query - RPC was hanging)
  const { data: activeSession, isLoading: sessionLoading, error: sessionError } = useQuery({
    queryKey: ['activeSession'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sessions')
        .select('id, name, start_date, announcement_date, status, desired_max_participants, current_participant_count, application_fee, currency, enable_waitlist, waitlist_count, review_progress, payment_instructions, target_applicants, deadline_datetime')
        .in('status', ['open', 'closed', 'results_published'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      return data;
    },
  });

  // Show loading state
  if (sessionLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Show error if session can't load
  if (sessionError) {
    return (
      <div className="container mx-auto px-4 py-16">
        <Card>
          <CardHeader>
            <CardTitle>Error Loading Session</CardTitle>
            <CardDescription>Unable to load the active session. Please try again later.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  // Show no active session message
  if (!activeSession) {
    return (
      <div className="container mx-auto px-4 py-16">
        <Card>
          <CardHeader>
            <CardTitle>No Active Session</CardTitle>
            <CardDescription>
              There is currently no active funding session. Please check back later or contact us for more information.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link to="/">Return Home</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!activeSession) {
      toast({
        title: t.common.error,
        description: 'No active session available',
        variant: 'destructive',
      });
      return;
    }

    // Check if session is full
    if (activeSession.current_participant_count >= activeSession.desired_max_participants) {
      toast({
        title: t.common.error,
        description: 'This session is full. Please wait for the next session.',
        variant: 'destructive',
      });
      return;
    }

    // Validate all agreements
    const allAgreed = Object.values(formData.agreements).every(Boolean);
    if (!allAgreed) {
      toast({
        title: t.common.error,
        description: 'Please accept all agreements',
        variant: 'destructive',
      });
      return;
    }

    // Validate form data
    const validationData = {
      fullName: formData.fullName,
      whatsappNumber: formData.whatsappNumber,
      email: formData.email,
      cityProvince: formData.cityProvince,
      projectTitle: formData.projectTitle,
      projectDescription: formData.projectDescription,
      estimatedRevenue: formData.estimatedRevenue,
      timeUntilProfit: formData.timeUntilProfit,
      feasibilityExplanation: formData.feasibilityExplanation,
      fundingNeeded: formData.fundingNeeded,
      willHire: formData.willHire,
      numberOfHires: formData.numberOfHires,
    };

    const result = applicationSchema.safeParse(validationData);
    if (!result.success) {
      toast({
        title: t.common.error,
        description: result.error.issues[0].message,
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);

    try {
      const { data, error } = await supabase.from('user_submissions').insert({
        session_id: activeSession.id,
        full_name: result.data.fullName,
        whatsapp_number: result.data.whatsappNumber,
        email: result.data.email,
        city_province: result.data.cityProvince,
        project_title: result.data.projectTitle,
        project_description: result.data.projectDescription,
        project_description_raw: result.data.projectDescription,
        estimated_monthly_revenue: parseFloat(result.data.estimatedRevenue),
        time_until_profit: result.data.timeUntilProfit,
        feasibility_explanation: result.data.feasibilityExplanation,
        funding_needed: parseInt(result.data.fundingNeeded),
        will_hire: result.data.willHire === 'yes',
        number_of_hires: result.data.willHire === 'yes' && result.data.numberOfHires ? parseInt(result.data.numberOfHires) : null,
        agreements_confirmed: true,
        payment_status: 'pending',
      }).select().single();

      if (error) throw error;

      // Trigger AI analysis in background (don't await to avoid blocking user)
      supabase.functions.invoke('analyze-submission', {
        body: { submissionId: data.id }
      }).then(() => {
        console.log('AI analysis triggered for submission:', data.id);
      }).catch(err => {
        console.error('Failed to trigger AI analysis:', err);
      });

      // Send confirmation email in background (temporarily disabled)
      // supabase.functions.invoke('send-confirmation-email', {
      //   body: { submissionId: data.id }
      // }).then(() => {
      //   console.log('Confirmation email sent for submission:', data.id);
      // }).catch(err => {
      //   console.error('Failed to send confirmation email:', err);
      // });

      // Update submission with session fee
      const sessionFee = activeSession.application_fee || 20;
      const sessionCurrency = activeSession.currency || 'USD';
      
      await supabase
        .from('user_submissions')
        .update({
          payment_amount: sessionFee,
          payment_currency: sessionCurrency,
          amount_due: sessionFee,
        })
        .eq('id', data.id);

      // Open payment dialog
      setSubmissionId(data.id);
      setPaymentDialogOpen(true);
      
      toast({
        title: t.common.success,
        description: 'Application submitted! Please complete payment.',
      });
    } catch (error) {
      console.error('Error submitting application:', error);
      toast({
        title: t.common.error,
        description: 'Failed to submit application. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  if (sessionLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!activeSession) {
    return (
      <div className="py-16 md:py-24">
        <div className="container mx-auto px-4">
          <Card className="max-w-2xl mx-auto shadow-elegant">
            <CardHeader>
              <CardTitle>No Active Session</CardTitle>
              <CardDescription>
                There is currently no active competition session. Please check back later or contact us for more information.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild>
                <Link to="/contact">{t.nav.contact}</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const sessionFull = activeSession.current_participant_count >= activeSession.desired_max_participants;

  if (sessionFull) {
    return (
      <div className="py-16 md:py-24">
        <div className="container mx-auto px-4">
          <Card className="max-w-2xl mx-auto shadow-elegant">
            <CardHeader>
              <CardTitle>Session Full</CardTitle>
              <CardDescription>
                This session is full. Please wait for the next session to open.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                Current participants: {activeSession.current_participant_count} / {activeSession.desired_max_participants}
              </p>
              <Button asChild>
                <Link to="/results">{t.nav.results}</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="py-16 md:py-24">
      <div className="container mx-auto px-4">
        {/* Header */}
        <div className="text-center space-y-4 mb-12">
          <h1 className="text-4xl md:text-5xl font-bold">{t.apply.title}</h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            {t.apply.subtitle}
          </p>
          <p className="text-sm text-muted-foreground">
            Session: {activeSession.name} ({activeSession.current_participant_count} / {activeSession.desired_max_participants} participants)
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="max-w-3xl mx-auto space-y-8">
          {/* Personal Information */}
          <Card className="shadow-card">
            <CardHeader>
              <CardTitle className="text-2xl">{t.apply.personalInfo}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="fullName">
                    {t.apply.fullName} <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="fullName"
                    value={formData.fullName}
                    onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                    maxLength={200}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="whatsappNumber">
                    {t.apply.whatsappNumber} <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="whatsappNumber"
                    type="tel"
                    value={formData.whatsappNumber}
                    onChange={(e) => setFormData({ ...formData, whatsappNumber: e.target.value })}
                    maxLength={20}
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="email">
                    {t.apply.email} <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    maxLength={255}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="cityProvince">
                    {t.apply.cityProvince} <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="cityProvince"
                    value={formData.cityProvince}
                    onChange={(e) => setFormData({ ...formData, cityProvince: e.target.value })}
                    maxLength={100}
                    required
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Project Information */}
          <Card className="shadow-card">
            <CardHeader>
              <CardTitle className="text-2xl">{t.apply.projectInfo}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="projectTitle">
                  {t.apply.projectTitle} <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="projectTitle"
                  maxLength={100}
                  value={formData.projectTitle}
                  onChange={(e) => setFormData({ ...formData, projectTitle: e.target.value })}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="projectDescription">
                  {t.apply.projectDescription} <span className="text-destructive">*</span>
                </Label>
                <Textarea
                  id="projectDescription"
                  rows={6}
                  maxLength={descriptionMaxLength}
                  value={formData.projectDescription}
                  onChange={(e) => setFormData({ ...formData, projectDescription: e.target.value })}
                  required
                  placeholder="Describe your project in detail..."
                />
                <p className="text-xs text-muted-foreground text-right">
                  {formData.projectDescription.length} / {descriptionMaxLength} {t.apply.charactersUsed}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Feasibility */}
          <Card className="shadow-card">
            <CardHeader>
              <CardTitle className="text-2xl">{t.apply.feasibility}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="estimatedRevenue">
                    {t.apply.estimatedRevenue} <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="estimatedRevenue"
                    type="number"
                    min="0"
                    step="0.01"
                    value={formData.estimatedRevenue}
                    onChange={(e) => setFormData({ ...formData, estimatedRevenue: e.target.value })}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="timeUntilProfit">
                    {t.apply.timeUntilProfit} <span className="text-destructive">*</span>
                  </Label>
                  <Select
                    value={formData.timeUntilProfit}
                    onValueChange={(value) => setFormData({ ...formData, timeUntilProfit: value })}
                    required
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t.common.required} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="immediately">{t.apply.immediately}</SelectItem>
                      <SelectItem value="1-3">{t.apply.oneToThree}</SelectItem>
                      <SelectItem value="3-6">{t.apply.threeToSix}</SelectItem>
                      <SelectItem value="6+">{t.apply.moreThanSix}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="feasibilityExplanation">
                  {t.apply.feasibilityExplanation} <span className="text-destructive">*</span>
                </Label>
                <Textarea
                  id="feasibilityExplanation"
                  rows={4}
                  maxLength={feasibilityMaxLength}
                  value={formData.feasibilityExplanation}
                  onChange={(e) => setFormData({ ...formData, feasibilityExplanation: e.target.value })}
                  required
                />
                <p className="text-xs text-muted-foreground text-right">
                  {formData.feasibilityExplanation.length} / {feasibilityMaxLength} {t.apply.charactersUsed}
                </p>
              </div>

              <div className="space-y-2">
                <Label>
                  {t.apply.fundingNeeded} <span className="text-destructive">*</span>
                </Label>
                <RadioGroup
                  value={formData.fundingNeeded}
                  onValueChange={(value) => setFormData({ ...formData, fundingNeeded: value })}
                  required
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="500" id="funding-500" />
                    <Label htmlFor="funding-500">$500</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="1000" id="funding-1000" />
                    <Label htmlFor="funding-1000">$1,000</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="2000" id="funding-2000" />
                    <Label htmlFor="funding-2000">$2,000</Label>
                  </div>
                </RadioGroup>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>
                    {t.apply.willHire} <span className="text-destructive">*</span>
                  </Label>
                  <RadioGroup
                    value={formData.willHire}
                    onValueChange={(value) => setFormData({ ...formData, willHire: value, numberOfHires: value === 'no' ? '' : formData.numberOfHires })}
                    required
                  >
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="yes" id="hire-yes" />
                      <Label htmlFor="hire-yes">{t.apply.yes}</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="no" id="hire-no" />
                      <Label htmlFor="hire-no">{t.apply.no}</Label>
                    </div>
                  </RadioGroup>
                </div>

                {formData.willHire === 'yes' && (
                  <div className="space-y-2">
                    <Label htmlFor="numberOfHires">{t.apply.numberOfHires}</Label>
                    <Input
                      id="numberOfHires"
                      type="number"
                      min="1"
                      value={formData.numberOfHires}
                      onChange={(e) => setFormData({ ...formData, numberOfHires: e.target.value })}
                    />
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Agreements */}
          <Card className="shadow-card">
            <CardHeader>
              <CardTitle className="text-2xl">{t.apply.agreements}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-start space-x-2">
                <Checkbox
                  id="ownProject"
                  checked={formData.agreements.ownProject}
                  onCheckedChange={(checked) =>
                    setFormData({
                      ...formData,
                      agreements: { ...formData.agreements, ownProject: checked as boolean },
                    })
                  }
                />
                <Label htmlFor="ownProject" className="font-normal cursor-pointer">
                  {t.apply.ownProject}
                </Label>
              </div>

              <div className="flex items-start space-x-2">
                <Checkbox
                  id="ageConfirm"
                  checked={formData.agreements.ageConfirm}
                  onCheckedChange={(checked) =>
                    setFormData({
                      ...formData,
                      agreements: { ...formData.agreements, ageConfirm: checked as boolean },
                    })
                  }
                />
                <Label htmlFor="ageConfirm" className="font-normal cursor-pointer">
                  {t.apply.ageConfirm}
                </Label>
              </div>

              <div className="flex items-start space-x-2">
                <Checkbox
                  id="feeNonRefundable"
                  checked={formData.agreements.feeNonRefundable}
                  onCheckedChange={(checked) =>
                    setFormData({
                      ...formData,
                      agreements: { ...formData.agreements, feeNonRefundable: checked as boolean },
                    })
                  }
                />
                <Label htmlFor="feeNonRefundable" className="font-normal cursor-pointer">
                  {t.apply.feeNonRefundable}
                </Label>
              </div>

              <div className="flex items-start space-x-2">
                <Checkbox
                  id="agreeToRules"
                  checked={formData.agreements.agreeToRules}
                  onCheckedChange={(checked) =>
                    setFormData({
                      ...formData,
                      agreements: { ...formData.agreements, agreeToRules: checked as boolean },
                    })
                  }
                />
                <Label htmlFor="agreeToRules" className="font-normal cursor-pointer">
                  {t.apply.agreeToRules} (<Link to="/terms" className="text-primary hover:underline">{t.nav.terms}</Link>)
                </Label>
              </div>
            </CardContent>
          </Card>

          <Button type="submit" size="lg" disabled={loading} className="w-full">
            {loading ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                {t.common.loading}
              </>
            ) : (
              t.apply.continueToPayment
            )}
          </Button>
        </form>

        {/* Payment Dialog */}
        <PaymentDialog
          open={paymentDialogOpen}
          onOpenChange={setPaymentDialogOpen}
          submissionId={submissionId}
          amount={activeSession?.application_fee || 20}
          currency={activeSession?.currency || 'USD'}
        />
      </div>
    </div>
  );
}
