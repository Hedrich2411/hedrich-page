import type { APIRoute } from "astro";
import { z } from "astro/zod";
import { enquirySchema } from "../../lib/enquiry";
import { sendEnquiry, smtpReady } from "../../lib/mail";

export const prerender = false; // the rest of the site stays static

// ponytail: in-memory limit, per instance, resets with the process.
// Fine for a personal site; move to Redis if it ever runs replicated.
const attempts = new Map<string, number[]>();
const WINDOW = 10 * 60_000;
const LIMIT = 3;

const tooMany = (ip: string) => {
	const now = Date.now();
	const recent = (attempts.get(ip) ?? []).filter((t) => now - t < WINDOW);
	attempts.set(ip, [...recent, now]);
	return recent.length >= LIMIT;
};

type Body = { message: string; fields?: Record<string, string> };

const reply = (body: Body, status: number) =>
	new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export const POST: APIRoute = async ({ request, clientAddress }) => {
	if (!smtpReady) return reply({ message: "El envío no está configurado todavía." }, 503);

	const form = await request.formData();

	// only bots fill the honeypot
	if (String(form.get("botcheck") ?? "")) return reply({ message: "Mensaje recibido." }, 200);

	// zod validates on the server: the HTML `required` is not a real barrier
	const parsed = enquirySchema.safeParse(Object.fromEntries(form));
	if (!parsed.success) {
		// one message per field, so the form can mark each input
		const fields = Object.fromEntries(
			Object.entries(z.flattenError(parsed.error).fieldErrors).map(([field, errors]) => [field, errors![0]]),
		);
		return reply({ message: "Revisá los campos marcados.", fields }, 400);
	}

	// counted here and not earlier: three typos should not lock anyone out
	// ponytail: behind nginx every request arrives with the proxy address, so the
	// bucket would be shared; spoofable if the app is ever exposed without a proxy
	const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || clientAddress;
	if (tooMany(ip)) return reply({ message: "Demasiados envíos seguidos. Probá en un rato." }, 429);

	try {
		await sendEnquiry(parsed.data);
	} catch (error) {
		console.error("[contact] send failed", error); // details stay in the log, not in the response
		return reply({ message: "No se pudo enviar. Escribime directo al correo." }, 502);
	}

	return reply({ message: "Mensaje enviado. Te respondo el mismo día hábil." }, 200);
};
