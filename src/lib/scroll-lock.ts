/**
 * Keeps the page still while an overlay is open.
 *
 * iOS Safari ignores `overflow: hidden` on the root for touch scrolling, so the
 * content behind a drawer or a sheet kept moving. Pinning the body at its
 * current offset is the one lock that holds everywhere; the offset goes back on
 * release, which is why this has to be shared state and not a local variable.
 */
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
