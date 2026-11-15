/**
 * El morf de la portada, solo cuando el viaje empieza en una tarjeta: con el
 * nombre en el HTML el navegador lo empareja en cualquier navegación.
 */

const nombre = (slug: string) => `portada-${slug}`;

let enViaje: string | null = null;

const portadaDe = (raiz: ParentNode, slug: string) =>
	raiz.querySelector<HTMLElement>(`[data-portada="${CSS.escape(slug)}"]`);

export function activarHeroDePortada() {
	// En captura: antes de que el router de Astro arranque la transición.
	document.addEventListener(
		"click",
		(evento) => {
			// Con modificador se abre otra pestaña y el nombre quedaría pegado acá.
			if (evento.button !== 0 || evento.metaKey || evento.ctrlKey || evento.shiftKey || evento.altKey) return;

			const enlace = (evento.target as Element | null)?.closest?.("a[href]");
			const slug = enlace?.getAttribute("href")?.match(/^\/proyectos\/([^/#?]+)\/?$/)?.[1];
			if (!slug) return;

			const portada = portadaDe(enlace as ParentNode, slug);
			if (!portada) return;

			portada.style.viewTransitionName = nombre(slug);
			enViaje = slug;
		},
		true,
	);

	// Corre dentro de startViewTransition, así que todavía entra en la instantánea.
	document.addEventListener("astro:after-swap", () => {
		if (!enViaje) return;
		const destino = portadaDe(document, enViaje);
		if (destino) destino.style.viewTransitionName = nombre(enViaje);
		enViaje = null;
	});
}
