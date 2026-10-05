import site from "../data/site.json";

export const projects = site.projects;
export type Project = (typeof projects)[number];
