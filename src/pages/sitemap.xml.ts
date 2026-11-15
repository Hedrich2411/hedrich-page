import type { APIRoute } from "astro";
import site from "../data/site.json";
import { getPosts } from "../lib/blog";
import { services, slugOf } from "../lib/services";

/** A mano y no @astrojs/sitemap: las rutas salen solas del filesystem y de las mismas fuentes que usan las páginas. */
const staticRoutes = Object.keys(import.meta.glob("./**/*.astro"))
	.filter((path) => !path.includes("[") && !path.startsWith("./api/"))
	.map((path) => path.replace(/^\.\//, "").replace(/(index)?\.astro$/, "").replace(/\/$/, ""));

export const GET: APIRoute = async ({ site: origin }) => {
	const posts = await getPosts();

	const urls = [
		...staticRoutes.map((route) => ({ path: route, date: null as Date | null })),
		...site.projects.map((project) => ({ path: `proyectos/${project.slug}`, date: null })),
		...services.map((service) => ({ path: `servicios/${slugOf(service)}`, date: null })),
		...posts.map((post) => ({ path: `blog/${post.id}`, date: post.data.date })),
	];

	const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
	.map(({ path, date }) => {
		// trailing slash to match the canonical the pages emit
		const loc = new URL(path ? `${path}/` : "", origin).href;
		const lastmod = date ? `<lastmod>${date.toISOString().slice(0, 10)}</lastmod>` : "";
		return `\t<url><loc>${loc}</loc>${lastmod}</url>`;
	})
	.join("\n")}
</urlset>`;

	return new Response(body, { headers: { "content-type": "application/xml" } });
};
