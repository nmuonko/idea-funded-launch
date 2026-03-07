/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Img,
  Preview,
  Text,
} from 'npm:@react-email/components@0.0.22'

interface ReauthenticationEmailProps {
  token: string
}

export const ReauthenticationEmail = ({ token }: ReauthenticationEmailProps) => (
  <Html lang="fr" dir="ltr">
    <Head />
    <Preview>Votre code de vérification AfriShop USA</Preview>
    <Body style={main}>
      <Container style={container}>
        <Img
          src="https://igmkhxffnyzoogcqvdab.supabase.co/storage/v1/object/public/email-assets/afrishop-logo.png"
          width="140"
          height="auto"
          alt="AfriShop USA"
          style={logo}
        />
        <Heading style={h1}>Code de vérification</Heading>
        <Text style={text}>Utilisez le code ci-dessous pour confirmer votre identité :</Text>
        <Text style={codeStyle}>{token}</Text>
        <Text style={footerText}>
          Ce code expirera sous peu. Si vous n'avez pas demandé ce code, vous pouvez
          ignorer cet e-mail en toute sécurité.
        </Text>
        <Text style={footerBrand}>
          © AfriShop USA — Vos produits favoris, livrés en Afrique.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default ReauthenticationEmail

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
const codeStyle = {
  fontFamily: 'Space Mono, Courier, monospace',
  fontSize: '28px',
  fontWeight: 'bold' as const,
  color: '#3b82f6',
  letterSpacing: '4px',
  margin: '0 0 28px',
  padding: '12px 16px',
  backgroundColor: '#f0f6ff',
  borderRadius: '8px',
  display: 'inline-block' as const,
}
const footerText = { fontSize: '13px', color: '#9ca3af', margin: '24px 0 8px', lineHeight: '1.5' }
const footerBrand = { fontSize: '12px', color: '#d1d5db', margin: '0', borderTop: '1px solid #e5e7eb', paddingTop: '16px' }
