import site from "../data/site.json";
import { projects } from "./projects";

export const services = site.services;
export const process = site.process;
export const faq = site.faq;

export type Service = (typeof services)[number];

/** Anchor for each service on /servicios, derived from its name. */
export const slugOf = (service: Service) =>
	service.name
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");

/** Projects that share a technology with the service, so each page shows real work. */
export const projectsFor = (service: Service) =>
	projects.filter((project) => project.stack.some((slug) => service.stack.includes(slug)));
