import {
	siDjango, siDocker, siFastapi, siGooglecloud, siJavascript, siKotlin,
	siLinux, siNextdotjs, siNginx, siNuxt, siOdoo, siPython, siReact,
} from "simple-icons";

/** Logos resolve at build time: simple-icons never reaches the browser. */
export const TECHNOLOGIES: Record<string, { name: string; path: string }> = {
	python: { name: "Python", path: siPython.path },
	django: { name: "Django", path: siDjango.path },
	fastapi: { name: "FastAPI", path: siFastapi.path },
	javascript: { name: "JavaScript", path: siJavascript.path },
	react: { name: "React", path: siReact.path },
	reactnative: { name: "React Native", path: siReact.path },
	nextdotjs: { name: "Next.js", path: siNextdotjs.path },
	nuxt: { name: "Nuxt", path: siNuxt.path },
	kotlin: { name: "Kotlin", path: siKotlin.path },
	odoo: { name: "Odoo", path: siOdoo.path },
	googlecloud: { name: "Google Cloud", path: siGooglecloud.path },
	docker: { name: "Docker", path: siDocker.path },
	nginx: { name: "Nginx", path: siNginx.path },
	linux: { name: "Linux", path: siLinux.path },
};

export const nameOf = (slug: string) => TECHNOLOGIES[slug]?.name ?? slug;
