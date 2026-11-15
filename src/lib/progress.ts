/** Avance de lectura en localStorage. Todo va en try: en privado lanza, no devuelve vacío. */
const KEY = "blog:read";

export const readIds = (): string[] => {
	try {
		return JSON.parse(localStorage.getItem(KEY) ?? "[]");
	} catch {
		return [];
	}
};

export const isRead = (id: string) => readIds().includes(id);

export const setRead = (id: string, read: boolean) => {
	try {
		const ids = new Set(readIds());
		read ? ids.add(id) : ids.delete(id);
		localStorage.setItem(KEY, JSON.stringify([...ids]));
	} catch {
		/* storage blocked: the page still works, the tick just will not persist */
	}
	document.dispatchEvent(new CustomEvent(PROGRESS_EVENT));
};

export const PROGRESS_EVENT = "blog:progress";
