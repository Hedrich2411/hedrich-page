const NAV = "[data-course-nav]";

const mostrarActual = (nav: HTMLElement) => {
	const actual = nav.querySelector<HTMLElement>('[aria-current="page"]');
	if (!actual) return;
	const caja = nav.getBoundingClientRect();
	const item = actual.getBoundingClientRect();
	if (item.top >= caja.top && item.bottom <= caja.bottom) return;
	nav.scrollTop += item.top - caja.top - (caja.height - item.height) / 2;
};

/** Entre lecciones del mismo curso el índice queda donde estaba: solo cambia el contenido. */
export const mantenerIndiceDelCurso = () => {
	let anterior: { curso: string; arriba: number } | null = null;

	document.addEventListener("astro:before-swap", () => {
		const nav = document.querySelector<HTMLElement>(NAV);
		anterior = nav ? { curso: nav.dataset.courseNav ?? "", arriba: nav.scrollTop } : null;
	});

	// after-swap corre antes del primer cuadro de la página nueva: el índice no llega a verse arriba.
	document.addEventListener("astro:after-swap", () => {
		const nav = document.querySelector<HTMLElement>(NAV);
		if (!nav) return;
		if (anterior && anterior.curso === nav.dataset.courseNav) nav.scrollTop = anterior.arriba;
		mostrarActual(nav);
	});

	document.addEventListener("astro:page-load", () => {
		const nav = document.querySelector<HTMLElement>(NAV);
		if (nav) mostrarActual(nav);
	});
};
