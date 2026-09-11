/**
 * Creates the detached host element that carries our shadow root. Everything we
 * render lives inside it, so the host application's stylesheets cannot reach
 * our internals and ours cannot leak into theirs.
 */
export function createShadowHost(doc: Document = document): {
  host: HTMLElement;
  shadow: ShadowRoot;
  destroy: () => void;
} {
  const host = doc.createElement('div');
  host.setAttribute('data-pointto-root', '');
  const shadow = host.attachShadow({ mode: 'open' });
  doc.body.appendChild(host);
  return { host, shadow, destroy: () => host.remove() };
}
