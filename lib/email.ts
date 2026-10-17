// Emails, sent with Resend when RESEND_API_KEY and EMAIL_FROM are set (EMAIL_FROM on a verified
// domain), and skipped otherwise: a missing key never breaks a signup. Waitlist confirmations go out
// after the response (after()); the MCP token email goes out before it, within a 10 s timeout, because
// the answer says whether it went. A send failure is logged without the address or the body and never
// fails the request.
import { Resend } from "resend";
import { redactTokens } from "./mcp/token";

type Env = Readonly<Record<string, string | undefined>>;

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  /** Resend drops a repeat send with the same key, so a retried signup never mails twice. */
  idempotencyKey?: string;
}

export interface Mailer {
  send(message: EmailMessage): Promise<void>;
}

/** Resend's SDK answers API errors as values; this turns them into a thrown error. */
export function resendMailer(apiKey: string, from: string): Mailer {
  const resend = new Resend(apiKey);
  return {
    async send(message) {
      const { error } = await resend.emails.send(
        { from, to: message.to, subject: message.subject, text: message.text },
        message.idempotencyKey ? { idempotencyKey: message.idempotencyKey } : undefined,
      );
      if (error) throw new Error(`Resend refused the email: ${error.name}`);
    },
  };
}

/** The mailer when both RESEND_API_KEY and EMAIL_FROM are set, else null (emails are skipped). */
export function mailerFromEnv(env: Env = process.env): Mailer | null {
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.EMAIL_FROM?.trim();
  return apiKey && from ? resendMailer(apiKey, from) : null;
}

/** The signup confirmation: short and plain. It holds only the position, never anything the visitor typed. */
export function confirmationEmail(position: number): { subject: string; text: string } {
  return {
    subject: "You're on the Stoop waitlist",
    text: [
      `You're #${position} on the Stoop waitlist.`,
      "",
      "Thanks for signing up. We'll be in touch about your free Culture Brief: the audience around your product, with the Qloo data behind it.",
      "",
      "We never sell your email or send it to Qloo. Didn't sign up? You can ignore this email.",
      "",
      "Stoop",
    ].join("\n"),
  };
}

/**
 * The MCP token, emailed once as the visitor's own copy (the screen shows it once too). It holds the
 * token and how to add it, never anything else the visitor typed.
 */
export function mcpTokenEmail(token: string, options: { origin: string; expiresAt: string; calls: number; cultureBriefs: number }): { subject: string; text: string } {
  const until = new Date(options.expiresAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/New_York" });
  return {
    subject: "Your Stoop MCP token",
    text: [
      "Here is your Stoop MCP token. Keep it private: anyone with it can use your daily calls.",
      "",
      token,
      "",
      "Add Stoop to Claude Code:",
      `claude mcp add --transport http stoop ${options.origin}/api/mcp --header "Authorization: Bearer ${token}"`,
      "",
      "If your client only takes a URL, use this one (it carries the token, so treat it like a password):",
      `${options.origin}/api/mcp/${token}`,
      "",
      `It works until ${until}, with up to ${options.calls} tool calls and ${options.cultureBriefs} culture briefs a day. Setup and help: ${options.origin}/mcp`,
      "",
      "Didn't ask for this? You can ignore this email.",
      "",
      "Stoop",
    ].join("\n"),
  };
}

export type SendOutcome = "sent" | "skipped" | "failed";

const SEND_TIMEOUT_MS = 10_000;

/** Sends one message with a timeout. Never throws: a failure is logged under `label`, without the address or the body. */
async function deliver(mailer: Mailer, message: EmailMessage, label: string): Promise<SendOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timed out after ${SEND_TIMEOUT_MS} ms`)), SEND_TIMEOUT_MS);
    });
    await Promise.race([mailer.send(message), timeout]);
    return "sent";
  } catch (error) {
    // The address is personal data and the body may hold a token: both stay out of the log.
    console.warn(redactTokens(`${label} failed: ${error instanceof Error ? error.message : String(error)}`));
    return "failed";
  } finally {
    clearTimeout(timer);
  }
}

/** Sends the confirmation, or skips it without a mailer. Never throws: a failure is logged and reported. */
export async function sendConfirmation(mailer: Mailer | null, to: string, position: number, idempotencyKey?: string): Promise<SendOutcome> {
  if (!mailer) return "skipped";
  return deliver(mailer, { to, ...confirmationEmail(position), ...(idempotencyKey ? { idempotencyKey } : {}) }, "Waitlist confirmation email");
}

/** Sends the MCP token email, or skips it without a mailer. Never throws. */
export async function sendMcpToken(mailer: Mailer | null, to: string, token: string, options: Parameters<typeof mcpTokenEmail>[1] & { idempotencyKey?: string }): Promise<SendOutcome> {
  if (!mailer) return "skipped";
  const { idempotencyKey, ...content } = options;
  return deliver(mailer, { to, ...mcpTokenEmail(token, content), ...(idempotencyKey ? { idempotencyKey } : {}) }, "MCP token email");
}
