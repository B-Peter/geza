/**
 * Returns true (and blanks the page) when loaded inside a frame. The app
 * then doesn't start, so nothing in it can be clicked through an overlay.
 */
export function framed(): boolean {
  let inFrame: boolean;
  try {
    inFrame = window.top !== window.self;
  } catch {
    inFrame = true; // cross-origin parent: accessing top throws
  }
  if (inFrame) {
    document.documentElement.replaceChildren();
    try {
      if (window.top) window.top.location.href = window.location.href;
    } catch {
      // Sandboxed frames can't navigate the parent; the blank page is enough.
    }
  }
  return inFrame;
}
