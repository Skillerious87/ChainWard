import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.chainward.app',
  appName: 'ChainWard',
  webDir: 'capacitor-www',
  server: {
    url: 'https://chain-ward-ebon.vercel.app',
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
