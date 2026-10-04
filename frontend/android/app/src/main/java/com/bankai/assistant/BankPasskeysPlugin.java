package com.bankai.assistant;

import android.os.Build;
import android.os.CancellationSignal;
import androidx.credentials.*;
import androidx.credentials.exceptions.CreateCredentialException;
import androidx.credentials.exceptions.GetCredentialException;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONObject;

/** Thin platform adapter. Only server-generated WebAuthn options enter this API;
 * the bank still verifies signatures, origin, challenge, ownership and UV. */
@CapacitorPlugin(name = "BankPasskeys")
public class BankPasskeysPlugin extends Plugin {
    private CancellationSignal pending;

    private String options(PluginCall call, boolean registration) throws Exception {
        if (Build.VERSION.SDK_INT < 28 || BuildConfig.PASSKEY_RP_ID.isEmpty())
            throw new IllegalArgumentException("Android Passkeys require a configured verified domain.");
        String json = call.getString("optionsJSON", "");
        if (json.length() > 32768) throw new IllegalArgumentException("Invalid Passkey options.");
        JSONObject data = new JSONObject(json);
        String rpId = registration ? data.getJSONObject("rp").getString("id") : data.getString("rpId");
        String uv = registration ? data.getJSONObject("authenticatorSelection").getString("userVerification") : data.getString("userVerification");
        if (!BuildConfig.PASSKEY_RP_ID.equals(rpId) || !"required".equals(uv) || data.getString("challenge").isEmpty())
            throw new IllegalArgumentException("Unexpected Passkey policy.");
        return json;
    }
    private boolean begin(PluginCall call) {
        if (pending != null) { call.reject("Another Passkey prompt is active.", "PASSKEY_BUSY"); return false; }
        pending = new CancellationSignal();
        return true;
    }
    private void result(PluginCall call, String json) {
        pending = null;
        try { JSObject result = new JSObject(); result.put("credential", new JSONObject(json)); call.resolve(result); }
        catch (Exception error) { call.reject("Invalid credential response.", "PASSKEY_UNAVAILABLE"); }
    }
    @PluginMethod
    public void register(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (!begin(call)) return;
            try {
                CreatePublicKeyCredentialRequest request = new CreatePublicKeyCredentialRequest(options(call, true));
                CredentialManager.create(getActivity()).createCredentialAsync(getActivity(), request, pending,
                    getActivity().getMainExecutor(), new CredentialManagerCallback<CreateCredentialResponse, CreateCredentialException>() {
                        public void onResult(CreateCredentialResponse response) {
                            if (response instanceof CreatePublicKeyCredentialResponse)
                                result(call, ((CreatePublicKeyCredentialResponse) response).getRegistrationResponseJson());
                            else { pending = null; call.reject("Unexpected credential type.", "PASSKEY_UNAVAILABLE"); }
                        }
                        public void onError(CreateCredentialException error) {
                            pending = null;
                            call.reject("Passkey creation was canceled or unavailable. Check the verified domain and credential provider.", "PASSKEY_UNAVAILABLE");
                        }
                    });
            } catch (Exception error) { pending = null; call.reject("Android Passkeys require matching verified-domain settings.", "PASSKEY_UNAVAILABLE"); }
        });
    }
    @PluginMethod
    public void authenticate(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (!begin(call)) return;
            try {
                GetCredentialRequest request = new GetCredentialRequest.Builder()
                    .addCredentialOption(new GetPublicKeyCredentialOption(options(call, false))).build();
                CredentialManager.create(getActivity()).getCredentialAsync(getActivity(), request, pending,
                    getActivity().getMainExecutor(), new CredentialManagerCallback<GetCredentialResponse, GetCredentialException>() {
                        public void onResult(GetCredentialResponse response) {
                            if (response.getCredential() instanceof PublicKeyCredential)
                                result(call, ((PublicKeyCredential) response.getCredential()).getAuthenticationResponseJson());
                            else { pending = null; call.reject("Unexpected credential type.", "PASSKEY_UNAVAILABLE"); }
                        }
                        public void onError(GetCredentialException error) {
                            pending = null;
                            call.reject("Passkey verification was canceled or unavailable. You may select password verification.", "PASSKEY_UNAVAILABLE");
                        }
                    });
            } catch (Exception error) { pending = null; call.reject("Android Passkeys require matching verified-domain settings.", "PASSKEY_UNAVAILABLE"); }
        });
    }
    @Override protected void handleOnDestroy() { if (pending != null) pending.cancel(); pending = null; }
}
