import type { Metadata } from "next";
import { ApiKeyHelpDialog } from "@/components/onboarding/api-key-help-dialog";
import { ConnectForm } from "@/components/onboarding/connect-form";
import { ConnectHomeLink } from "@/components/onboarding/connect-home-link";
import { InstallPrompt } from "@/components/onboarding/install-prompt";
import { LoginBackdrop } from "@/components/onboarding/login-backdrop";
import { offlineTestModeEnabled } from "@/lib/torn/offline-fixture";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Connect a restricted Torn API key to open your verified Chainward faction workspace.",
};

export default function ConnectPage() {
  return (
    <main className="connect-page login-page">
      <LoginBackdrop />

      <ConnectHomeLink />
      <ApiKeyHelpDialog />

      <div className="login-shell">
        <section className="login-card" aria-label="Sign in to Chainward">
          <ConnectForm offlineEnabled={offlineTestModeEnabled()} />
        </section>

        <p className="login-legal">
          Independent community software · Not affiliated with Torn
          <span>Torn City · Faction Ops · Secure by Design</span>
        </p>
      </div>

      <InstallPrompt />
    </main>
  );
}
