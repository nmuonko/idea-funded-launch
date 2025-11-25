import { useLanguage } from '@/contexts/LanguageContext';

export default function Privacy() {
  const { t } = useLanguage();

  return (
    <div className="py-16 md:py-24">
      <div className="container mx-auto px-4 max-w-4xl">
        <h1 className="text-4xl md:text-5xl font-bold mb-4">AfriFund Privacy Notice</h1>
        <p className="text-muted-foreground mb-12">Last updated: January 2025</p>

        <div className="prose prose-gray dark:prose-invert max-w-none space-y-8">
          <section>
            <h2 className="text-2xl font-semibold mb-4">1. Introduction</h2>
            <p className="text-muted-foreground">
              AfriFund is a small independent team that believes in fair chances for local entrepreneurs.
              This Privacy Notice explains how we collect, use, store, and protect your personal data when you visit our website, contact us, or participate in the AfriFund competition.
            </p>
            <p className="text-muted-foreground">
              By using our website or submitting information to us, you agree to this Notice. If you do not agree, please do not use the site or submit personal data.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">2. Who we are</h2>
            <p className="text-muted-foreground">
              AfriFund<br />
              Lubumbashi, Democratic Republic of Congo<br />
              Email: <a href="mailto:info@afri-fund.org" className="text-primary hover:underline">info@afri-fund.org</a>
            </p>
            <p className="text-muted-foreground">
              For the purposes of this Notice, AfriFund is the "data controller," meaning we decide how and why your personal data is processed.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">3. What this Notice covers</h2>
            <p className="text-muted-foreground mb-3">This Privacy Notice applies when:</p>
            <ul className="list-disc pl-6 space-y-2 text-muted-foreground">
              <li>You visit our website or landing pages</li>
              <li>You create an account or sign in</li>
              <li>You apply to the AfriFund competition or submit a project</li>
              <li>You contact us via email, WhatsApp, or our contact form</li>
              <li>You make or receive payments related to the competition</li>
            </ul>
            <p className="text-muted-foreground mt-3">
              It does not cover third-party websites, services, or payment providers that we link to. These services have their own privacy policies.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">4. Personal data we collect</h2>
            <p className="text-muted-foreground mb-3">Depending on how you interact with AfriFund, we may collect the following categories of data:</p>
            
            <h3 className="text-xl font-semibold mb-3 mt-6">Information you provide directly</h3>
            <ul className="list-disc pl-6 space-y-2 text-muted-foreground">
              <li><strong>Identification details:</strong> full name, country/city, date of birth or age range (if required for eligibility)</li>
              <li><strong>Contact details:</strong> email address, WhatsApp number, other phone numbers</li>
              <li><strong>Account details:</strong> username, password (stored securely in hashed form)</li>
              <li><strong>Application information:</strong> project description, budget, business idea, pitch documents, supporting materials</li>
              <li><strong>Communication:</strong> messages sent via our contact form, email, or WhatsApp</li>
              <li><strong>Payment-related information:</strong> payment status, transaction reference, amount paid, method used (we do not store your full card or mobile money details; this is handled by our payment providers such as MaishaPay or others)</li>
            </ul>

            <h3 className="text-xl font-semibold mb-3 mt-6">Information collected automatically</h3>
            <p className="text-muted-foreground mb-3">When you use our website, we may automatically collect:</p>
            <ul className="list-disc pl-6 space-y-2 text-muted-foreground">
              <li>Device and browser information (e.g., type of device, browser version, operating system)</li>
              <li>Log data (IP address, pages visited, time and date of visits, referring pages)</li>
              <li>Basic analytics data to understand how visitors use our site</li>
            </ul>
            <p className="text-muted-foreground mt-3">
              We do not use this information to identify you personally unless required for security or fraud prevention.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">5. How we use your personal data</h2>
            <p className="text-muted-foreground mb-3">We use your data for the following purposes:</p>
            
            <h3 className="text-xl font-semibold mb-3 mt-6">To run the AfriFund competition</h3>
            <ul className="list-disc pl-6 space-y-2 text-muted-foreground">
              <li>Register applicants and manage accounts</li>
              <li>Receive, review, and evaluate project applications</li>
              <li>Communicate with you about deadlines, results, and next steps</li>
              <li>Transfer funds to selected participants and keep financial records</li>
            </ul>

            <h3 className="text-xl font-semibold mb-3 mt-6">To communicate with you</h3>
            <ul className="list-disc pl-6 space-y-2 text-muted-foreground">
              <li>Respond to questions and support requests</li>
              <li>Send important updates about the program, changes to terms, or this Notice</li>
              <li>Share information about future AfriFund sessions or similar initiatives (you can opt out at any time)</li>
            </ul>

            <h3 className="text-xl font-semibold mb-3 mt-6">To operate and improve our website</h3>
            <ul className="list-disc pl-6 space-y-2 text-muted-foreground">
              <li>Maintain and secure our site and services</li>
              <li>Monitor usage for troubleshooting and performance</li>
              <li>Improve the user experience and simplify the application process</li>
            </ul>

            <h3 className="text-xl font-semibold mb-3 mt-6">To meet legal and regulatory obligations</h3>
            <ul className="list-disc pl-6 space-y-2 text-muted-foreground">
              <li>Keep appropriate accounting and tax records</li>
              <li>Prevent fraud, abuse, or misuse of the platform</li>
              <li>Respond to lawful requests from authorities where required</li>
            </ul>

            <p className="text-muted-foreground mt-6 font-semibold">We do not sell your personal data.</p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">6. Legal bases for processing</h2>
            <p className="text-muted-foreground mb-3">Depending on your location, we rely on one or more of the following legal bases:</p>
            <ul className="list-disc pl-6 space-y-2 text-muted-foreground">
              <li><strong>Contract</strong> – when processing is necessary to provide the AfriFund competition or related services you've requested</li>
              <li><strong>Legitimate interest</strong> – for running and improving our program, preventing fraud, and communicating with participants in a balanced way</li>
              <li><strong>Consent</strong> – for certain types of communications (e.g., marketing emails or messaging) where required by law</li>
              <li><strong>Legal obligation</strong> – where we must keep records or share information to comply with applicable laws</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">7. How we share your personal data</h2>
            <p className="text-muted-foreground mb-3">We may share your data with the following categories of recipients, only when necessary:</p>
            <ul className="list-disc pl-6 space-y-2 text-muted-foreground">
              <li>Service providers who help us operate the website, host data, send emails, process payments, or provide analytics</li>
              <li>Payment providers (such as MaishaPay or mobile money partners) to process entry fees or fund disbursements</li>
              <li>Advisors, judges, or reviewers who assist in evaluating project applications (they only receive the information they need)</li>
              <li>Public authorities or law enforcement when required by law, court order, or to protect our rights or participants' safety</li>
            </ul>
            <p className="text-muted-foreground mt-3">
              All service providers are required to handle your data securely and only according to our instructions.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">8. International transfers</h2>
            <p className="text-muted-foreground">
              Our team and service providers may be located in different countries (for example, the DRC, the United States, or the European Union). This means your data may be transferred and stored outside your country of residence.
            </p>
            <p className="text-muted-foreground mt-3">
              Where required by law, we take reasonable steps to ensure that such transfers are protected by appropriate safeguards (for example, contractual clauses or equivalent protections).
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">9. Data retention</h2>
            <p className="text-muted-foreground mb-3">We keep your personal data only for as long as necessary to:</p>
            <ul className="list-disc pl-6 space-y-2 text-muted-foreground">
              <li>Run the competition and manage your application or account</li>
              <li>Maintain accurate financial and tax records</li>
              <li>Resolve disputes and enforce our agreements</li>
              <li>Comply with legal obligations</li>
            </ul>
            <p className="text-muted-foreground mt-3 mb-3">In general:</p>
            <ul className="list-disc pl-6 space-y-2 text-muted-foreground">
              <li>Application data is kept for as long as the relevant session is active, and for a reasonable period afterwards to evaluate and improve the program.</li>
              <li>Basic account, payment, and support records may be kept for several years where required by law.</li>
              <li>When data is no longer needed, we will delete it or anonymize it.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">10. How we protect your data</h2>
            <p className="text-muted-foreground mb-3">We apply technical and organizational measures to protect your personal data, including:</p>
            <ul className="list-disc pl-6 space-y-2 text-muted-foreground">
              <li>Limiting access to personal data to people who need it to perform their role</li>
              <li>Using secure hosting and encryption where appropriate</li>
              <li>Regularly reviewing our practices and tools</li>
            </ul>
            <p className="text-muted-foreground mt-3">
              However, no system can be 100% secure. You also play a role in protecting your data by keeping your login details confidential and contacting us immediately if you suspect unauthorized access.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">11. Your rights</h2>
            <p className="text-muted-foreground mb-3">Depending on your location and applicable law, you may have some or all of the following rights:</p>
            <ul className="list-disc pl-6 space-y-2 text-muted-foreground">
              <li><strong>Access</strong> – request a copy of the personal data we hold about you</li>
              <li><strong>Correction</strong> – ask us to correct inaccurate or incomplete data</li>
              <li><strong>Deletion</strong> – request that we delete your data, where legally allowed</li>
              <li><strong>Restriction</strong> – ask us to limit how we use your data in certain cases</li>
              <li><strong>Objection</strong> – object to certain types of processing based on legitimate interests</li>
              <li><strong>Data portability</strong> – request a copy of your data in a structured, commonly used format</li>
            </ul>
            <p className="text-muted-foreground mt-3">
              You can exercise these rights by contacting us at <a href="mailto:info@afri-fund.org" className="text-primary hover:underline">info@afri-fund.org</a>. We may need to verify your identity before responding.
            </p>
            <p className="text-muted-foreground mt-3">
              You also have the right to lodge a complaint with your local data protection authority if you believe your rights have been violated. We encourage you to contact us first so we can try to resolve any issue.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">12. Children's privacy</h2>
            <p className="text-muted-foreground">
              AfriFund is designed primarily for adults and young adults who can legally enter into agreements in their country. We do not knowingly collect personal data from children under the age where parental consent is required, unless such consent has been properly obtained.
            </p>
            <p className="text-muted-foreground mt-3">
              If you believe a child has provided us with personal data without the necessary consent, please contact us and we will take appropriate action.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">13. Third-party links</h2>
            <p className="text-muted-foreground">
              Our website may contain links to third-party websites or services (for example, payment providers, social media, or partner organizations). We are not responsible for the privacy practices of those third parties. We encourage you to read their privacy policies before sharing any personal data.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">14. Changes to this Privacy Notice</h2>
            <p className="text-muted-foreground">
              We may update this Privacy Notice from time to time to reflect changes in our practices, technologies, or legal requirements. When we do, we will update the "Last updated" date at the top of this page. Significant changes may be communicated via email or a notice on our website.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">15. How to contact us</h2>
            <p className="text-muted-foreground">
              If you have any questions, concerns, or requests regarding this Privacy Notice or your personal data, you can contact us at:
            </p>
            <p className="text-muted-foreground mt-3">
              AfriFund<br />
              Lubumbashi, Democratic Republic of Congo<br />
              Email: <a href="mailto:info@afri-fund.org" className="text-primary hover:underline">info@afri-fund.org</a>
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
