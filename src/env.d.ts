/// <reference types="astro/client" />

interface ImportMetaEnv {
	/** SMTP for the contact form. No PUBLIC_ prefix: server-side only. */
	readonly SMTP_HOST?: string;
	readonly SMTP_PORT?: string;
	readonly SMTP_USER?: string;
	readonly SMTP_PASS?: string;
	/** Mailbox the messages are sent from; must match the authenticated account. */
	readonly SMTP_ADMIN_EMAIL?: string;
	/** Display name shown as the sender. */
	readonly SMTP_SENDER_NAME?: string;
	/** Where enquiries land. Falls back to SMTP_ADMIN_EMAIL. */
	readonly SMTP_TO?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
