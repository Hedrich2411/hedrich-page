/** 24x24 stroke paths, lucide style. Brand logos come from simple-icons. */
export const ICONS = {
	terminal: "m5 7 4 4-4 4M13 16h6",
	mail: "M3 7h18v10H3zM3 7l9 6 9-6",
	pin: "M12 21s7-6.4 7-11a7 7 0 1 0-14 0c0 4.6 7 11 7 11Z",
	clock: "M12 7v5l3 2",
	globe: "M3 12h18M12 3c2.5 3 2.5 15 0 18M12 3c-2.5 3-2.5 15 0 18",
	arrow: "M5 12h14M13 6l6 6-6 6",
	linkedin: "M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4v-7a6 6 0 0 1 6-6z",
	copy: "M9 9V5.5A1.5 1.5 0 0 1 10.5 4h8A1.5 1.5 0 0 1 20 5.5v8a1.5 1.5 0 0 1-1.5 1.5H15M5.5 9h8A1.5 1.5 0 0 1 15 10.5v8a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 4 18.5v-8A1.5 1.5 0 0 1 5.5 9Z",
	check: "m5 13 4 4L19 7",
	externalLink: "M7 17 17 7M9 7h8v8",
	search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-4-4",
	braces: "M8 4a2 2 0 0 0-2 2v3a2 2 0 0 1-2 2 2 2 0 0 1 2 2v3a2 2 0 0 0 2 2M16 4a2 2 0 0 1 2 2v3a2 2 0 0 0 2 2 2 2 0 0 0-2 2v3a2 2 0 0 1-2 2",
	plug: "M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0V8ZM12 17v4",
	bulb: "M9 18h6M10 21h4M12 3a6 6 0 0 0-3 11v2h6v-2a6 6 0 0 0-3-11Z",
	save: "M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6",
	list: "M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01",
} as const;

export type IconName = keyof typeof ICONS;
