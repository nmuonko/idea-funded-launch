/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Img,
  Preview,
  Text,
} from 'npm:@react-email/components@0.0.22'

interface RecoveryEmailProps {
  siteName: string
  confirmationUrl: string
}

export const RecoveryEmail = ({
  siteName,
  confirmationUrl,
}: RecoveryEmailProps) => (
  <Html lang="fr" dir="ltr">
    <Head />
    <Preview>Réinitialisez votre mot de passe AfriShop USA</Preview>
    <Body style={main}>
      <Container style={container}>
        <Img
          src="https://igmkhxffnyzoogcqvdab.supabase.co/storage/v1/object/public/email-assets/afrishop-logo.png"
          width="140"
          height="auto"
          alt="AfriShop USA"
          style={logo}
        />
        <Heading style={h1}>Réinitialisez votre mot de passe</Heading>
        <Text style={text}>
          Nous avons reçu une demande de réinitialisation de votre mot de passe AfriShop USA.
          Cliquez sur le bouton ci-dessous pour choisir un nouveau mot de passe.
        </Text>
        <Button style={button} href={confirmationUrl}>
          Réinitialiser le mot de passe
        </Button>
        <Text style={footerText}>
          Si vous n'avez pas demandé cette réinitialisation, vous pouvez ignorer cet e-mail.
          Votre mot de passe ne sera pas modifié.
        </Text>
        <Text style={footerBrand}>
          © AfriShop USA — Vos produits favoris, livrés en Afrique.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default RecoveryEmail

const main = { backgroundColor: '#ffffff', fontFamily: 'Inter, Arial, sans-serif' }
const container = { padding: '32px 24px', maxWidth: '480px', margin: '0 auto' }
const logo = { marginBottom: '24px' }
const h1 = {
  fontSize: '22px',
  fontWeight: 'bold' as const,
  color: '#111318',
  margin: '0 0 16px',
}
const text = {
  fontSize: '15px',
  color: '#4b5563',
  lineHeight: '1.6',
  margin: '0 0 20px',
}
const button = {
  backgroundColor: '#3b82f6',
  color: '#f8fafc',
  fontSize: '15px',
  fontWeight: '600' as const,
  borderRadius: '8px',
  padding: '14px 24px',
  textDecoration: 'none',
  display: 'inline-block' as const,
  margin: '8px 0 24px',
}
const footerText = { fontSize: '13px', color: '#9ca3af', margin: '24px 0 8px', lineHeight: '1.5' }
const footerBrand = { fontSize: '12px', color: '#d1d5db', margin: '0', borderTop: '1px solid #e5e7eb', paddingTop: '16px' }
