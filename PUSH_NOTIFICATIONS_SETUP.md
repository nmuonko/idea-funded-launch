# Push Notifications Setup Guide

This guide explains how to integrate push notifications with your native mobile app.

## Overview

The AfriShop backend now supports push notifications for cart recovery. The system includes:
1. Device token registration endpoint
2. Push notification sending service
3. Integration with abandoned cart recovery

## Required Secrets

You need to add these secrets in your Supabase project for push notifications to work:

### For Android (Firebase Cloud Messaging)
- `FCM_SERVER_KEY` - Your Firebase Cloud Messaging server key

### For iOS (Apple Push Notification Service)
- `APNS_KEY_ID` - Your Apple Push Notification Service key ID
- `APNS_TEAM_ID` - Your Apple Developer team ID
- `APNS_AUTH_KEY` - Your APNS authentication key

## Mobile App Integration

### 1. Register Device Token

When a user logs in to your mobile app, register their device token:

```typescript
// iOS (React Native example)
import PushNotification from 'react-native-push-notification';

PushNotification.configure({
  onRegister: async function (token) {
    // Send token to backend
    await fetch('https://igmkhxffnyzoogcqvdab.supabase.co/functions/v1/register-device-token', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${userAuthToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        deviceToken: token.token,
        platform: 'ios', // or 'android'
      }),
    });
  },
});

// Android
// Similar setup, just change platform to 'android'
```

### 2. Handle Incoming Notifications

```typescript
PushNotification.configure({
  onNotification: function (notification) {
    console.log('NOTIFICATION:', notification);
    
    // If it's an abandoned cart notification
    if (notification.data?.type === 'abandoned_cart') {
      // Navigate to cart screen
      navigation.navigate('Cart', {
        orderId: notification.data.orderId
      });
    }
  },
});
```

## Backend Flow

1. **Cart Abandonment Detected**: When a cart is abandoned for 24h, 48h, or 72h
2. **Email Sent**: System sends recovery email with personalized content
3. **Push Notification Sent**: If user has registered device token, push notification is sent
4. **A/B Testing**: System tracks which timing variant was used
5. **Conversion Tracking**: When user completes order, system records conversion

## Firebase Cloud Messaging Setup (Android)

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Create a new project or select existing
3. Add Android app to your Firebase project
4. Download `google-services.json`
5. Get your Server Key from Project Settings → Cloud Messaging
6. Add `FCM_SERVER_KEY` secret to Supabase

## Apple Push Notification Service Setup (iOS)

1. Go to [Apple Developer Portal](https://developer.apple.com/)
2. Create an App ID with Push Notifications capability
3. Generate an APNs Auth Key
4. Download the .p8 key file
5. Add these secrets to Supabase:
   - `APNS_KEY_ID`
   - `APNS_TEAM_ID`
   - `APNS_AUTH_KEY` (content of .p8 file)

## Testing Push Notifications

### Manual Test

You can manually test push notifications using the edge function:

```bash
curl -X POST https://igmkhxffnyzoogcqvdab.supabase.co/functions/v1/send-push-notification \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user-uuid-here",
    "title": "Test Notification",
    "body": "This is a test push notification",
    "data": {
      "type": "test"
    }
  }'
```

## Database Tables

### device_tokens
Stores user device tokens for push notifications:
- `id` - Unique identifier
- `user_id` - User who owns the device
- `device_token` - FCM or APNS device token
- `platform` - 'ios' or 'android'
- `created_at` - When token was registered
- `updated_at` - Last update time
- `last_used_at` - Last time token was used

### cart_recovery_ab_tests
Tracks A/B test performance:
- `id` - Unique identifier
- `order_id` - Associated order
- `variant_name` - '24h', '48h', or '72h'
- `sent_at` - When recovery message was sent
- `email_opened` - Whether email was opened
- `converted` - Whether user completed order
- `cart_value_usd` - Cart value at time of abandonment
- `segment` - Customer segment (high_value, standard)

## A/B Test Results

View A/B test performance in the Admin Portal:
- Go to Admin → A/B Test Results
- See conversion rates for each timing variant
- Track total revenue from recovered carts
- Compare high-value vs standard segment performance

## Troubleshooting

### Notifications Not Received

1. Check device token is registered in `device_tokens` table
2. Verify FCM_SERVER_KEY or APNS credentials are set correctly
3. Check edge function logs in Supabase
4. Ensure mobile app has notification permissions enabled
5. Test with manual curl request first

### Email Sent But No Push

- Push notifications are optional - system continues if push fails
- Check if user has registered a device token
- Verify platform credentials (FCM/APNS) are configured

### Conversion Not Tracked

- Conversions must be manually marked in the A/B test table
- Or implement webhook when order status changes to 'COMPLETED'
- Update `cart_recovery_ab_tests` table: `converted = true`

## Next Steps

1. Add FCM and APNS credentials to Supabase secrets
2. Integrate device token registration in your mobile app
3. Test push notifications with manual trigger
4. Monitor A/B test results in admin dashboard
5. Optimize timing based on conversion data
