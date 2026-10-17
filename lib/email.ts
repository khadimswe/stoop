// Emails, sent with Resend when RESEND_API_KEY and EMAIL_FROM are set (EMAIL_FROM on a verified
// domain), and skipped otherwise: a missing key never breaks a signup. Callers send after the
// response (after()), and a send failure is logged without the address and never fails the signup.
import { Resend } from "resend";

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

export type SendOutcome = "sent" | "skipped" | "failed";

const SEND_TIMEOUT_MS = 10_000;

/** Sends the confirmation, or skips it without a mailer. Never throws: a failure is logged and reported. */
export async function sendConfirmation(mailer: Mailer | null, to: string, position: number, idempotencyKey?: string): Promise<SendOutcome> {
  if (!mailer) return "skipped";
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timed out after ${SEND_TIMEOUT_MS} ms`)), SEND_TIMEOUT_MS);
    });
    await Promise.race([mailer.send({ to, ...confirmationEmail(position), ...(idempotencyKey ? { idempotencyKey } : {}) }), timeout]);
    return "sent";
  } catch (error) {
    // The address is personal data: it stays out of the log.
    console.warn(`Waitlist confirmation email failed: ${error instanceof Error ? error.message : String(error)}`);
    return "failed";
  } finally {
    clearTimeout(timer);
  }
}
