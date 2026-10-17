import { describe, expect, it, vi } from "vitest";
import { confirmationEmail, mailerFromEnv, sendConfirmation, type Mailer } from "./email";

describe("mailerFromEnv", () => {
  it("is null (emails skipped) unless both RESEND_API_KEY and EMAIL_FROM are set", () => {
    expect(mailerFromEnv({})).toBeNull();
    expect(mailerFromEnv({ RESEND_API_KEY: "re_test" })).toBeNull();
    expect(mailerFromEnv({ EMAIL_FROM: "Stoop <hello@stoop.example>" })).toBeNull();
    expect(mailerFromEnv({ RESEND_API_KEY: "  ", EMAIL_FROM: "Stoop <hello@stoop.example>" })).toBeNull();
    expect(mailerFromEnv({ RESEND_API_KEY: "re_test", EMAIL_FROM: "Stoop <hello@stoop.example>" })).not.toBeNull();
  });
});

describe("confirmationEmail", () => {
  it("is short and plain, carries the position, and makes no promise it can't keep", () => {
    const { subject, text } = confirmationEmail(42);
    expect(subject).toBe("You're on the Stoop waitlist");
    expect(text).toContain("You're #42 on the Stoop waitlist.");
    expect(text).toContain("We never sell your email or send it to Qloo.");
    expect(text).not.toContain(String.fromCharCode(0x2014));
    expect(text.length).toBeLessThan(500);
  });
});

describe("sendConfirmation", () => {
  it("skips without a mailer", async () => {
    expect(await sendConfirmation(null, "ana@shop.example", 1)).toBe("skipped");
  });

  it("sends the confirmation with an idempotency key", async () => {
    const send = vi.fn<Mailer["send"]>(async () => {});
    expect(await sendConfirmation({ send }, "ana@shop.example", 7, "waitlist-confirm-abc")).toBe("sent");
    expect(send).toHaveBeenCalledWith({ to: "ana@shop.example", ...confirmationEmail(7), idempotencyKey: "waitlist-confirm-abc" });
  });

  it("never throws when the send fails, and keeps the address out of the log", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failing: Mailer = { send: async () => Promise.reject(new Error("Resend refused the email: validation_error")) };
    expect(await sendConfirmation(failing, "ana@shop.example", 3)).toBe("failed");
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0][0])).not.toContain("ana@shop.example");
    warn.mockRestore();
  });
});
