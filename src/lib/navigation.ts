import { services, slugOf } from "./services";

export type NavLink = {
	href: string;
	label: string;
	/** icon path, drawn by the mobile dock */
	d: string;
	/** when present the desktop navbar renders a dropdown instead of a plain link */
	menu?: { href: string; label: string }[];
	/** marks the link active on every page under this path */
	prefix?: string;
};

/** Single source for links: consumed by the desktop navbar and the mobile dock. */
export const links: NavLink[] = [
	{ href: "/", label: "Inicio", d: "M3 10.5 12 3l9 7.5M5.25 9.75V20a1 1 0 0 0 1 1h11.5a1 1 0 0 0 1-1V9.75" },
	{ href: "/proyectos", label: "Proyectos", d: "M4 5h6v6H4zM14 5h6v6h-6zM4 13h6v6H4zM14 13h6v6h-6z" },
	{
		// there is no services index: the entry points at the first one and the
		// dropdown (desktop) or the tab strip on the page (mobile) reaches the rest
		href: `/servicios/${slugOf(services[0])}`,
		label: "Servicios",
		prefix: "/servicios/",
		d: "M4 8h16v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V8ZM9 8V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2",
		menu: services.map((service) => ({ href: `/servicios/${slugOf(service)}`, label: service.name })),
	},
	{ href: "/blog", label: "Blog", d: "M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6" },
	{ href: "/contacto", label: "Contacto", d: "M3 7h18v10H3zM3 7l9 6 9-6" },
];

export const isActive = (link: NavLink, path: string) =>
	link.href === path || (!!link.prefix && path.startsWith(link.prefix));

/** Shared by the plain links and the dropdown trigger, so both age the same way. */
export const navLinkClass = (active: boolean) => [
	"relative py-1 transition-colors",
	active
		? "text-primary"
		: "after:absolute after:inset-x-0 after:-bottom-0.5 after:h-0.5 after:origin-left after:scale-x-0 after:bg-primary after:transition-transform after:duration-300 hover:after:scale-x-100",
];
