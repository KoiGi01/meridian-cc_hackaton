/**
 * Widget styles. Lives inside the shadow root, so nothing here can leak into
 * the host and nothing from the host can reach in. Everything is explicit
 * because `:host { all: initial }` wipes inherited defaults.
 */
export const WIDGET_CSS = `
.pt-trigger, .pt-panel, .pt-panel * {
  box-sizing: border-box;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 14px;
  line-height: 1.45;
}
.pt-trigger {
  position: fixed;
  bottom: 20px;
  width: 52px;
  height: 52px;
  border-radius: 50%;
  border: none;
  cursor: pointer;
  background: #18181b;
  color: #fff;
  font-size: 22px;
  box-shadow: 0 6px 20px rgba(0,0,0,.28);
  display: flex;
  align-items: center;
  justify-content: center;
}
.pt-trigger:hover { background: #27272a; }
.pt-trigger:focus-visible, .pt-panel button:focus-visible, .pt-input:focus-visible {
  outline: 2px solid #60a5fa;
  outline-offset: 2px;
}
.pt-right { right: 20px; }
.pt-left { left: 20px; }

.pt-panel {
  position: fixed;
  bottom: 84px;
  width: 360px;
  max-width: calc(100vw - 40px);
  max-height: min(520px, calc(100vh - 110px));
  display: flex;
  flex-direction: column;
  background: #18181b;
  color: #e4e4e7;
  border: 1px solid #3f3f46;
  border-radius: 14px;
  box-shadow: 0 16px 40px rgba(0,0,0,.4);
  overflow: hidden;
}
.pt-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px 10px 16px;
  border-bottom: 1px solid #27272a;
}
.pt-head strong { font-weight: 600; color: #fafafa; }
.pt-exit {
  background: transparent;
  border: 1px solid #3f3f46;
  color: #d4d4d8;
  border-radius: 8px;
  padding: 4px 10px;
  cursor: pointer;
}
.pt-exit:hover { background: #27272a; }

.pt-transcript {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 0;
}
.pt-turn { max-width: 92%; padding: 8px 12px; border-radius: 12px; white-space: pre-wrap; }
.pt-user { align-self: flex-end; background: #2563eb; color: #fff; border-bottom-right-radius: 4px; }
.pt-agent { align-self: flex-start; background: #27272a; border-bottom-left-radius: 4px; }
.pt-empty { color: #a1a1aa; }
.pt-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.pt-chip {
  background: #3f3f46;
  color: #fafafa;
  border: none;
  border-radius: 999px;
  padding: 4px 10px;
  cursor: pointer;
  font-size: 13px;
}
.pt-chip:hover { background: #52525b; }

.pt-form {
  display: flex;
  gap: 8px;
  padding: 12px;
  border-top: 1px solid #27272a;
}
.pt-input {
  flex: 1;
  background: #09090b;
  color: #fafafa;
  border: 1px solid #3f3f46;
  border-radius: 10px;
  padding: 9px 12px;
}
.pt-input::placeholder { color: #71717a; }
.pt-send {
  background: #2563eb;
  color: #fff;
  border: none;
  border-radius: 10px;
  padding: 0 14px;
  cursor: pointer;
  font-weight: 600;
}
.pt-send:disabled { opacity: .5; cursor: default; }

@media (prefers-reduced-motion: no-preference) {
  .pt-panel { animation: pt-in 160ms ease-out; }
  @keyframes pt-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
}
`;
