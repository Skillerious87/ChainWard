import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.chainward.app',
  appName: 'ChainWard',
  webDir: 'capacitor-www',
  server: {
    url: 'https://chain-ward-ebon.vercel.app',
    cleartext: false
  }
};

export default config;
