import { z } from "astro/zod";

const KINDS = [
	"App móvil",
	"Sistema web a medida",
	"Integración o ERP",
	"Infraestructura y despliegue",
	"Rescate de un proyecto",
	"Otra cosa",
] as const;

/** Shared shape for the contact form. The select feeds off the same list it validates against. */
export const enquirySchema = z.object({
	name: z.string().trim().min(2, "Poné tu nombre.").max(120, "El nombre es demasiado largo."),
	email: z
		.string()
		.trim()
		.max(200, "El correo es demasiado largo.")
		.pipe(z.email("Ese correo no parece válido.")),
	kind: z.enum(KINDS).catch("Otra cosa"), // a tampered select falls back instead of failing
	message: z
		.string()
		.trim()
		.min(10, "Contame un poco más, con una frase alcanza.")
		.max(4000, "El mensaje es demasiado largo."),
});

export type Enquiry = z.infer<typeof enquirySchema>;
export const enquiryKinds = KINDS;
