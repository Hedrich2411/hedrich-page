import { glob } from "astro/loaders";
import { defineCollection } from "astro:content";
import { z } from "astro/zod";

/** A post is always a post. Belonging to a course is optional metadata. */
const posts = defineCollection({
	loader: glob({ base: "./src/content/posts", pattern: "**/*.md" }),
	schema: z.object({
		title: z.string(),
		description: z.string(),
		date: z.coerce.date(),
		tags: z.array(z.string()).default([]),
		/** shown as the row's category and drives the topic filters */
		topic: z.string(),
		/** what the reader walks away with; renders as the lesson callout */
		goal: z.string().optional(),
		draft: z.boolean().default(false),
		/** id of the course it belongs to, if any */
		course: z.string().optional(),
		/** id of the section inside that course */
		section: z.string().optional(),
		/** position inside the section */
		order: z.number().default(0),
	}),
});

/** A course is a reading order over posts, grouped into sections. */
const courses = defineCollection({
	loader: glob({ base: "./src/content/courses", pattern: "**/*.md" }),
	schema: z.object({
		title: z.string(),
		description: z.string(),
		kind: z.enum(["curso", "tutorial"]).default("curso"),
		level: z.enum(["Inicial", "Intermedio", "Avanzado"]).default("Inicial"),
		sections: z.array(z.object({ id: z.string(), title: z.string() })),
		stack: z.array(z.string()).default([]),
		topic: z.string(),
		updated: z.coerce.date(),
	}),
});

export const collections = { posts, courses };
