import { getCollection, type CollectionEntry } from "astro:content";

export type Post = CollectionEntry<"posts">;
type Course = CollectionEntry<"courses">;

const WORDS_PER_MINUTE = 220;

/** Rough reading time from the raw markdown. Good enough, and free. */
export const readingTime = (post: Post) =>
	Math.max(1, Math.round((post.body?.split(/\s+/).length ?? 0) / WORDS_PER_MINUTE));

const published = (post: Post) => import.meta.env.DEV || !post.data.draft;

/** Every post, newest first. */
export const getPosts = async () =>
	(await getCollection("posts", published)).sort((a, b) => +b.data.date - +a.data.date);

/** Posts that do not belong to any course. */
export const getLoosePosts = async () => (await getPosts()).filter((p) => !p.data.course);

/** A course with its posts already grouped and ordered by section. */
export type CourseOutline = {
	course: Course;
	sections: { id: string; title: string; posts: Post[] }[];
	posts: Post[]; // flattened, in reading order
};

const getOutline = async (course: Course): Promise<CourseOutline> => {
	const own = (await getPosts()).filter((p) => p.data.course === course.id);

	const sections = course.data.sections.map((section) => ({
		...section,
		posts: own
			.filter((p) => p.data.section === section.id)
			.sort((a, b) => a.data.order - b.data.order),
	}));

	return { course, sections, posts: sections.flatMap((s) => s.posts) };
};

export const getOutlines = async () =>
	Promise.all((await getCollection("courses")).map(getOutline)).then((list) =>
		list.sort((a, b) => +b.course.data.updated - +a.course.data.updated),
	);

/** The outline a post belongs to, plus where it sits in the reading order. */
export const getContext = async (post: Post) => {
	if (!post.data.course) return null;
	const course = (await getCollection("courses")).find((c) => c.id === post.data.course);
	if (!course) return null;

	const outline = await getOutline(course);
	const index = outline.posts.findIndex((p) => p.id === post.id);
	return {
		outline,
		index,
		previous: outline.posts[index - 1],
		next: outline.posts[index + 1],
	};
};

const SHORT_DATE = new Intl.DateTimeFormat("es-PE", { day: "2-digit", month: "short", year: "numeric" });

/** "13 jul 2026": es-PE abbreviates with a trailing dot that reads as noise here */
export const dateLabel = (date: Date) => SHORT_DATE.format(date).replace(".", "");

/** Every topic present in the library, in the order the filters show them. */
export const getTopics = async () => {
	const posts = await getPosts();
	const courses = await getCollection("courses");
	return [...new Set([...courses.map((c) => c.data.topic), ...posts.map((p) => p.data.topic)])].sort();
};

/** Initials for the author chip on a lesson. */
export const initialsOf = (name: string) =>
	name
		.split(" ")
		.slice(0, 2)
		.map((word) => word[0])
		.join("")
		.toUpperCase();
