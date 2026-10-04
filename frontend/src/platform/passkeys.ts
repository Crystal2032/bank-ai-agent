import { Capacitor, registerPlugin } from "@capacitor/core";
import {
  browserSupportsWebAuthn as browserAvailable,
  startAuthentication as browserAuthentication,
  startRegistration as browserRegistration,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type PublicKeyCredentialCreationOptionsJSON,
} from "@simplewebauthn/browser";

interface NativePasskeys {
  authenticate(options: {
    optionsJSON: string;
  }): Promise<{ credential: AuthenticationResponseJSON }>;
  register(options: {
    optionsJSON: string;
  }): Promise<{ credential: RegistrationResponseJSON }>;
}
const native = registerPlugin<NativePasskeys>("BankPasskeys");
const nativeRpId = import.meta.env.VITE_ANDROID_PASSKEY_RP_ID || "";
const ipHost =
  typeof window !== "undefined" &&
  (/^\d+\.\d+\.\d+\.\d+$/.test(window.location.hostname ?? "") ||
    (window.location.hostname ?? "").includes(":"));

export function browserSupportsWebAuthn() {
  return Capacitor.isNativePlatform()
    ? Boolean(nativeRpId)
    : !ipHost && browserAvailable();
}
export const passkeyUnavailableMessage = Capacitor.isNativePlatform()
  ? "Android Passkeys require a configured verified domain. Use password verification until setup is complete."
  : ipHost
    ? "Passkeys require a domain name; an HTTPS IP address is insufficient. Use password verification."
    : "This browser does not support Passkeys. Use localhost or a configured HTTPS address in a current browser.";
export async function startAuthentication({
  optionsJSON,
}: {
  optionsJSON: PublicKeyCredentialRequestOptionsJSON;
}) {
  if (!Capacitor.isNativePlatform())
    return browserAuthentication({ optionsJSON });
  if (!nativeRpId || optionsJSON.rpId !== nativeRpId)
    throw new Error(
      "Android Passkeys require a configured, verified domain. Use password verification.",
    );
  return (
    await native.authenticate({ optionsJSON: JSON.stringify(optionsJSON) })
  ).credential;
}
export async function startRegistration({
  optionsJSON,
}: {
  optionsJSON: PublicKeyCredentialCreationOptionsJSON;
}) {
  if (!Capacitor.isNativePlatform())
    return browserRegistration({ optionsJSON });
  if (!nativeRpId || optionsJSON.rp.id !== nativeRpId)
    throw new Error("Android Passkeys require a configured, verified domain.");
  return (await native.register({ optionsJSON: JSON.stringify(optionsJSON) }))
    .credential;
}
