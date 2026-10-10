import nodemailer from "nodemailer";

type Env = Record<string, string | undefined>;

export type MailAttachment = { filename: string; content: Buffer; contentType?: string };
export type MailInput = {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
  attachments?: MailAttachment[];
  replyTo?: string;
};

export function isMailConfigured(env: Env = process.env): boolean {
  return Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASSWORD);
}

let transport: nodemailer.Transporter | null = null;

function getTransport(env: Env) {
  if (!transport) {
    const port = Number(env.SMTP_PORT ?? 465);
    transport = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
    });
  }
  return transport;
}

/**
 * Sends an email via SMTP. When SMTP is not configured the message is logged instead, so flows
 * like invitations still work during local development.
 */
export async function sendMail(
  input: MailInput,
  env: Env = process.env,
): Promise<{ delivered: boolean; id?: string }> {
  const from = env.EMAIL_FROM || "JustCall <no-reply@example.ch>";
  if (!isMailConfigured(env)) {
    console.info(
      `[mail:dev] To: ${Array.isArray(input.to) ? input.to.join(", ") : input.to}\nSubject: ${input.subject}\n\n${input.text}\n` +
        (input.attachments?.length
          ? `(attachments: ${input.attachments.map((a) => a.filename).join(", ")})`
          : ""),
    );
    return { delivered: false };
  }
  const info = await getTransport(env).sendMail({
    from,
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html,
    replyTo: input.replyTo,
    attachments: input.attachments,
  });
  return { delivered: true, id: info.messageId };
}

export async function verifyMailTransport(env: Env = process.env) {
  if (!isMailConfigured(env)) throw new Error("SMTP is not configured");
  await getTransport(env).verify();
  return true;
}
