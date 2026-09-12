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
    SplashScreen: {
      launchShowDuration: 5000,
      launchAutoHide: true,
      launchFadeOutDuration: 450,
      backgroundColor: '#080D0F',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true
    }
  }
};

export default config;
