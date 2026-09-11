/**
 * Widget styles. Lives inside the shadow root, so nothing here can leak into
 * the host and nothing from the host can reach in. Everything is explicit
 * because `:host { all: initial }` wipes inherited defaults.
 */
export const WIDGET_CSS = `
.pt-orb, .pt-caption, .pt-panel, .pt-panel * {
  box-sizing: border-box;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 14px;
  line-height: 1.45;
}
.pt-orb {
  --pt-level: 0;
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
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 6px 20px rgba(0,0,0,.28);
  transition: box-shadow 70ms linear, transform 70ms linear, background 200ms ease;
}
.pt-orb:hover { background: #27272a; }

/* Session open, nobody talking: a quiet warm ring says "on". */
.pt-orb-live {
  box-shadow: 0 6px 20px rgba(0,0,0,.28), 0 0 0 2px rgb(251 191 36 / .55);
}

/* The agent speaking. --pt-level is the real audio level, 0..1, set per chunk. */
.pt-orb-agent {
  background: #1c1917;
  transform: scale(calc(1 + 0.10 * var(--pt-level)));
  box-shadow:
    0 6px 20px rgba(0,0,0,.28),
    0 0 0 2px rgb(251 191 36 / calc(.45 + .5 * var(--pt-level))),
    0 0 calc(10px + 44px * var(--pt-level)) calc(2px + 14px * var(--pt-level)) rgb(251 191 36 / calc(.18 + .55 * var(--pt-level)));
}

/* The user speaking: cooler, steadier, clearly not the agent. */
.pt-orb-user {
  box-shadow: 0 6px 20px rgba(0,0,0,.28), 0 0 0 3px rgb(147 197 253 / .7), 0 0 18px 4px rgb(147 197 253 / .35);
}
@media (prefers-reduced-motion: no-preference) {
  .pt-orb-user { animation: pt-listen 1.1s ease-in-out infinite; }
  @keyframes pt-listen {
    0%, 100% { box-shadow: 0 6px 20px rgba(0,0,0,.28), 0 0 0 3px rgb(147 197 253 / .7), 0 0 14px 2px rgb(147 197 253 / .25); }
    50%      { box-shadow: 0 6px 20px rgba(0,0,0,.28), 0 0 0 3px rgb(147 197 253 / .9), 0 0 24px 8px rgb(147 197 253 / .45); }
  }
}
@media (prefers-reduced-motion: reduce) {
  .pt-orb { transition: none; }
  .pt-orb-agent { transform: none; box-shadow: 0 6px 20px rgba(0,0,0,.28), 0 0 0 3px rgb(251 191 36 / .85); }
}

/* What the agent said, while the chat is hidden. Sits beside the orb. */
.pt-caption {
  position: fixed;
  bottom: 28px;
  max-width: min(340px, calc(100vw - 110px));
  background: #18181b;
  color: #e4e4e7;
  border: 1px solid #3f3f46;
  border-left: 3px solid #fbbf24;
  border-radius: 10px;
  padding: 8px 12px;
  font-size: 13px;
  line-height: 1.4;
  box-shadow: 0 8px 24px rgba(0,0,0,.35);
  cursor: pointer;
}
.pt-caption.pt-right { right: 84px; }
.pt-caption.pt-left { left: 84px; }
@media (prefers-reduced-motion: no-preference) {
  .pt-caption { animation: pt-in 160ms ease-out; }
}

.pt-collapse {
  background: transparent;
  border: 1px solid #3f3f46;
  color: #d4d4d8;
  border-radius: 8px;
  width: 30px;
  height: 28px;
  margin-right: 6px;
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
}
.pt-collapse:hover { background: #27272a; }

.pt-foot {
  padding: 6px 12px 8px;
  text-align: center;
  font-size: 11px;
  color: #71717a;
  letter-spacing: .01em;
}
.pt-wordmark { color: #a1a1aa; font-weight: 600; }
.pt-wordmark::after { content: '.'; color: #fbbf24; }

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
.pt-status { flex: 1; text-align: right; margin-right: 10px; color: #a1a1aa; font-size: 12px; }
.pt-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #71717a; vertical-align: middle; }
.pt-dot-live { background: #22c55e; box-shadow: 0 0 0 3px rgba(34,197,94,.25); }
.pt-system { align-self: center; background: transparent; color: #a1a1aa; font-size: 12px; text-align: center; }
.pt-partial { opacity: .55; font-style: italic; }
.pt-mic {
  width: 40px;
  border: 1px solid #3f3f46;
  border-radius: 10px;
  background: #27272a;
  color: #fafafa;
  cursor: pointer;
  font-size: 16px;
}
.pt-mic:hover { background: #3f3f46; }
.pt-mic:disabled { opacity: .5; cursor: default; }
.pt-mic-live { background: #dc2626; border-color: #dc2626; }
.pt-mic-live:hover { background: #b91c1c; }
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
