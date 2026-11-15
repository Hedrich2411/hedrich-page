/** Fija el body: iOS ignora `overflow: hidden` en la raíz al hacer scroll táctil. */
let savedY = 0;

export const lockScroll = () => {
	if (document.body.style.position === "fixed") return;
	savedY = window.scrollY;
	Object.assign(document.body.style, {
		position: "fixed",
		top: `-${savedY}px`,
		left: "0",
		right: "0",
		overflow: "hidden",
	});
};

export const unlockScroll = () => {
	if (document.body.style.position !== "fixed") return;
	Object.assign(document.body.style, { position: "", top: "", left: "", right: "", overflow: "" });
	window.scrollTo({ top: savedY, behavior: "instant" });
};
