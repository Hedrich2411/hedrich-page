import nodemailer, { type Transporter } from "nodemailer";
import type { Enquiry } from "./enquiry";

const env = import.meta.env;

export const smtpReady = Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS);

/** One transport reused across requests: opening one per message is slow and floods the server. */
let transport: Transporter | null = null;

const getTransport = () => {
	const port = Number(env.SMTP_PORT ?? 587);
	transport ??= nodemailer.createTransport({
		host: env.SMTP_HOST,
		port,
		secure: port === 465, // 587 negotiates TLS with STARTTLS instead
		auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
	});
	return transport;
};

/** Providers reject a `from` that is not the authenticated mailbox. */
const sender = () => `"${env.SMTP_SENDER_NAME ?? "hedrich.dev"}" <${env.SMTP_ADMIN_EMAIL ?? env.SMTP_USER}>`;

export const sendEnquiry = async ({ name, email, kind, message }: Enquiry) => {
	await getTransport().sendMail({
		from: sender(),
		to: env.SMTP_TO ?? env.SMTP_ADMIN_EMAIL ?? env.SMTP_USER,
		replyTo: `"${name}" <${email}>`, // replying goes straight to whoever wrote in
		subject: `Consulta: ${kind} — ${name}`,
		text: `Nombre: ${name}\nCorreo: ${email}\nNecesita: ${kind}\n\n${message}\n`,
	});
};

