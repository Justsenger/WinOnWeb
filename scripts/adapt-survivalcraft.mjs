// Adapter for the installed Survivalcraft.Browser 1.9.5.1 input/render bridge.
export function adaptSurvivalcraftMain(source) {
  if (!source.includes('const observer = new ResizeObserver(entries => {') ||
      !source.includes('runtime.setModuleImports("main.js"')) return source;
  return source
    .replace('let canvasWidth = 1;', 'let wowRenderScale = 1;\nlet canvasWidth = 1;')
    .replace(/const observer = new ResizeObserver\(entries => \{[\s\S]*?(?=const runningWorkers)/, `const updateCanvasSize = () => {
            const rect = canvas.getBoundingClientRect();
            if (!rect.width || !rect.height) return;
            const hostWidth = globalThis.frameElement?.getBoundingClientRect().width || rect.width;
            const displayScale = (globalThis.devicePixelRatio || 1) * hostWidth / globalThis.innerWidth;
            // Limit fragment work on touch devices while keeping UI and input in the same coordinate space.
            const budgetScale = globalThis.navigator.maxTouchPoints > 0
                ? Math.sqrt((1280 * 720) / (rect.width * rect.height))
                : Infinity;
            wowRenderScale = Math.min(displayScale, budgetScale);
            canvasWidth = Math.max(1, Math.round(rect.width * wowRenderScale));
            canvasHeight = Math.max(1, Math.round(rect.height * wowRenderScale));
            `)
    .replace(/\}\);\s*observer\.observe\(canvas\);/, `};
        new ResizeObserver(updateCanvasSize).observe(canvas);
        globalThis.addEventListener("resize", updateCanvasSize);
        globalThis.addEventListener("pagehide", () => globalThis.removeEventListener("resize", updateCanvasSize), { once: true });`)
    .replace('STRUCT.OFF_DEVICE_PIXEL_RATIO, globalThis.devicePixelRatio', 'STRUCT.OFF_DEVICE_PIXEL_RATIO, wowRenderScale')
    .replaceAll('const devicePixelRatio = globalThis.devicePixelRatio || 1.0;', 'const devicePixelRatio = wowRenderScale;')
    .replace('const pointerUp = e => {', 'const pointerUp = e => {\n            const devicePixelRatio = wowRenderScale;')
    .replace('canvas.addEventListener("contextmenu"', `canvas.style.webkitTouchCallout = "none";
        canvas.style.userSelect = "none";
        canvas.addEventListener("touchstart", e => e.preventDefault(), { passive: false });
        canvas.addEventListener("pointercancel", pointerUp);
        canvas.addEventListener("contextmenu"`)
    .replaceAll('document.fullscreenElement === canvas', '(globalThis.wowViewFullscreen || document.fullscreenElement === canvas)')
    .replace('document.addEventListener("fullscreenchange", fullscreenChange', 'globalThis.addEventListener("wow-window-fullscreen-change", fullscreenChange')
    .replace(/setFullscreen: async \(flag\) => \{[\s\S]*?(?=\s*showKeyboard:)/, `setFullscreen: async flag => {
        if (globalThis.frameElement) globalThis.frameElement.dispatchEvent(new CustomEvent("wow-window-fullscreen", { detail: Boolean(flag) }));
        else if (flag) await canvas.requestFullscreen();
        else if (document.fullscreenElement) await document.exitFullscreen();
    },`);
}
