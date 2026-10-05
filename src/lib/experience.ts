import site from "../data/site.json";

const SHORT_MONTH = new Intl.DateTimeFormat("es-PE", { month: "short", year: "numeric" });

/** "2024-11" -> "nov 2024" */
export const monthLabel = (value: string) => {
	const [year, month] = value.split("-").map(Number);
	return SHORT_MONTH.format(new Date(year, month - 1)).replace(".", "");
};

const toMonths = (value: string) => {
	const [year, month] = value.split("-").map(Number);
	return year * 12 + (month - 1);
};

const now = new Date();
const currentMonth = now.getFullYear() * 12 + now.getMonth();

// chronological order: oldest first
const rawJobs = [...site.experience].reverse().map((job) => ({
	...job,
	start: toMonths(job.from),
	end: job.to ? toMonths(job.to) : currentMonth,
}));

const axisStart = Math.min(...rawJobs.map((j) => j.start));
const axisEnd = currentMonth + 3; // breathing room so the "today" line never touches the edge
const totalMonths = axisEnd - axisStart;

/** Position on the axis, as a % of the whole range. The chart is all percentages: responsive with no JS. */
const percent = (month: number) => ((month - axisStart) / totalMonths) * 100;

export const jobs = rawJobs.map((job) => {
	const width = ((job.end - job.start + 1) / totalMonths) * 100;
	const left = percent(job.start);
	return {
		...job,
		left,
		width,
		months: job.end - job.start + 1,
		labelFits: width >= 22, // does the month label fit inside the bar?
		alignRight: left > 50, // the popover anchors on whichever side keeps it in view
	};
});

/** The starting point plus every January within range. */
export const guides = [
	{ label: monthLabel(site.experience.at(-1)!.from), x: 0 },
	...Array.from({ length: Math.floor(axisEnd / 12) - Math.ceil((axisStart + 1) / 12) + 1 }, (_, i) => {
		const year = Math.ceil((axisStart + 1) / 12) + i;
		return { label: String(year), x: percent(year * 12) };
	}),
];

export const todayX = percent(currentMonth);
export const technologiesUsed = [...new Set(jobs.flatMap((job) => job.stack))];
