import site from "../data/site.json";

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
