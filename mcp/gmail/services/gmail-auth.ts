import { google, type gmail_v1 } from "googleapis";
import { SecretsManager, type GmailCredentials } from "../../../managers/secrets-manager.js";

const secretsManager = new SecretsManager();

/**
 * Returns an authenticated Gmail API client.
 *
 * Resolution order:
 *   1. Credentials stored in secrets/gmail/credentials.json (OAuth flow)
 *   2. Fallback to environment variables (legacy .env approach)
 *
 * This lets the new OAuth UI flow work while keeping backward-compatibility.
 */
export async function getGmailClient(): Promise<gmail_v1.Gmail> {
  // Try secrets directory first
  const stored = await secretsManager.loadCredentials<GmailCredentials>("gmail");

  const clientId = stored?.client_id || process.env.GMAIL_CLIENT_ID;
  const clientSecret = stored?.client_secret || process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = stored?.refresh_token || process.env.GMAIL_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "Gmail not connected. Please connect your Gmail account from the Settings page, " +
      "or provide GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, and GMAIL_REFRESH_TOKEN in .env",
    );
  }

  const oAuth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oAuth2Client.setCredentials({ refresh_token: refreshToken });

  return google.gmail({ version: "v1", auth: oAuth2Client });
}
