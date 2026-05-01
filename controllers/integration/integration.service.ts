import { google } from "googleapis";
import { SecretsManager } from "../../managers/secrets-manager.js";
import { logger } from "../../services/logger.js";

const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.modify",
];

export interface GmailAuthUrl {
  url: string;
}

export interface GmailCallbackResult {
  success: boolean;
  redirectUrl: string;
}

export interface IntegrationStatus {
  connected: boolean;
  email?: string;
  connected_at?: string;
}

/**
 * Encapsulates integration business logic (Gmail OAuth, etc.).
 * Adding a new integration only requires adding methods here
 * and wiring them in the controller.
 */
export class IntegrationService {
  constructor(private readonly secretsManager: SecretsManager) {}

  // ─── Gmail ─────────────────────────────────────────────

  /** Build the Google OAuth consent URL. */
  getGmailAuthUrl(protocol: string, host: string): GmailAuthUrl {
    const clientId = process.env.GMAIL_CLIENT_ID;
    const clientSecret = process.env.GMAIL_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new Error(
        "GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET must be set in .env. " +
          "Create OAuth credentials at https://console.cloud.google.com/apis/credentials",
      );
    }

    const redirectUri = `${protocol}://${host}/api/auth/gmail/callback`;
    const oAuth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

    const url = oAuth2Client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: GMAIL_SCOPES,
    });

    return { url };
  }

  /** Exchange OAuth code for tokens and persist credentials. */
  async handleGmailCallback(
    code: string,
    protocol: string,
    host: string,
  ): Promise<GmailCallbackResult> {
    const clientId = process.env.GMAIL_CLIENT_ID!;
    const clientSecret = process.env.GMAIL_CLIENT_SECRET!;
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
    const redirectUri = `${protocol}://${host}/api/auth/gmail/callback`;
    const oAuth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

    try {
      const { tokens } = await oAuth2Client.getToken(code);
      oAuth2Client.setCredentials(tokens);

      // Get user's email address
      const gmail = google.gmail({ version: "v1", auth: oAuth2Client });
      const profile = await gmail.users.getProfile({ userId: "me" });
      const email = profile.data.emailAddress || "unknown";

      // Store in secrets/gmail/credentials.json
      await this.secretsManager.saveCredentials("gmail", {
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: tokens.refresh_token,
        access_token: tokens.access_token,
        token_expiry: tokens.expiry_date,
        connected_at: new Date().toISOString(),
        email,
      });

      logger.info(`Gmail connected for ${email}`);
      return { success: true, redirectUrl: `${frontendUrl}?gmail=connected` };
    } catch (err) {
      logger.error(`Gmail OAuth error: ${err}`);
      return { success: false, redirectUrl: `${frontendUrl}?gmail=error` };
    }
  }

  /** Get the current connection status for Gmail. */
  async getGmailStatus(): Promise<IntegrationStatus> {
    return this.secretsManager.getStatus("gmail");
  }

  /** Disconnect Gmail by removing stored credentials. */
  async disconnectGmail(): Promise<void> {
    await this.secretsManager.deleteCredentials("gmail");
    logger.info("Gmail disconnected");
  }
}
