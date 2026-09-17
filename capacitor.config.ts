import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.chainward.app',
  appName: 'ChainWard',
  webDir: 'capacitor-www',
  server: {
    // Native launches skip the marketing homepage entirely and open straight
    // on sign-in - an installed app doesn't need the pitch a browser visitor
    // does, and /connect's own auto-unlock effect (connect-form.tsx) is what
    // makes a returning device with an enrolled passkey feel instant anyway.
    url: 'https://chain-ward-ebon.vercel.app/connect',
    cleartext: false
  },
  plugins: {
    PushNotifications: {
      // Without this, @capacitor/push-notifications' Android implementation
      // never calls notificationManager.notify() for an incoming FCM message
      // - foreground or background - so pushes are received but never shown
      // in the system tray at all, regardless of server-side payload
      // correctness. See PushNotificationsPlugin.java's fireNotification().
      presentationOptions: ['alert', 'sound', 'badge']
    }
  }
};

export default config;
