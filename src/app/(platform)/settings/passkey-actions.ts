"use server";

import "server-only";

import { revalidatePath } from "next/cache";
import { recordAuthEvent } from "@/lib/torn/auth-audit";
import { currentConnectionScope } from "@/lib/torn/current-connection-scope";
import { deleteWebauthnCredential, findCredentialFingerprint, listCredentialsForFingerprint, type WebauthnCredentialSummary } from "@/lib/torn/webauthn-credentials";

export interface PasskeyActionResult {
  ok: boolean;
  message: string;
}

export async function listMyPasskeys(): Promise<WebauthnCredentialSummary[]> {
  const scope = await currentConnectionScope();
  if (!scope) return [];
  return listCredentialsForFingerprint(scope.keyFingerprint);
}

export async function removeMyPasskey(credentialId: string): Promise<PasskeyActionResult> {
  const scope = await currentConnectionScope();
  if (!scope) return { ok: false, message: "Sign in with your API key first." };
  // Never trust a bare client-supplied credential ID - confirm it actually
  // belongs to the caller's own connection before deleting anything.
  const ownerFingerprint = await findCredentialFingerprint(credentialId);
  if (!ownerFingerprint || ownerFingerprint !== scope.keyFingerprint) {
    return { ok: false, message: "That passkey could not be found." };
  }
  await deleteWebauthnCredential(credentialId);
  await recordAuthEvent("auth.passkey_removed", {
    tornFactionId: scope.tornFactionId,
    tornUserId: scope.tornUserId,
    keyFingerprint: scope.keyFingerprint,
    entityType: "WebAuthnCredential",
    entityId: credentialId,
  });
  revalidatePath("/settings");
  return { ok: true, message: "Passkey removed." };
}
