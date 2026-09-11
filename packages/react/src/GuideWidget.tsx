import { findElementById, type IntentMatch } from 'pointto-core';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useGuide } from './GuideProvider';
import { WIDGET_CSS } from './widget-styles';

export interface GuideWidgetProps {
  position?: 'bottom-right' | 'bottom-left';
  /** Shown in the panel header. */
  title?: string;
  placeholder?: string;
  /** Set by the provider so the widget sits above the overlay. */
  zIndex?: number;
}

interface Turn {
  role: 'user' | 'agent';
  text: string;
  /** Present on an ambiguous reply: the choices offered. */
  choices?: IntentMatch[];
}

/**
 * The text-mode widget. Voice arrives later as a mic button next to the input,
 * driving exactly the same `ask` — this is the fallback that has to work when
 * the microphone is denied or the office is loud (BUILD-SPEC 5.5).
 *
 * The microphone is never opened here. Nothing in this component touches
 * navigator.mediaDevices.
 */
export function GuideWidget({
  position = 'bottom-right',
  title = 'Ask where',
  placeholder = 'How do I…',
  zIndex = 2147483001,
}: GuideWidgetProps) {
  const { ask, guide, manifest, clear } = useGuide();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);

  const side = position === 'bottom-left' ? 'pt-left' : 'pt-right';

  const close = useCallback(() => {
    setOpen(false);
    clear();
  }, [clear]);

  // Escape always closes. Registered only while open, on window, capture
  // phase, so it works no matter what in the host has focus.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, close]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    const el = transcriptRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns]);

  const purposeOf = (id: string) =>
    (manifest && findElementById(manifest, id)?.purpose) || 'Here it is.';

  const say = (text: string, choices?: IntentMatch[]) =>
    setTurns((t) => [...t, { role: 'agent', text, ...(choices ? { choices } : {}) }]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q || busy) return;
    setQuery('');
    setTurns((t) => [...t, { role: 'user', text: q }]);
    setBusy(true);
    try {
      const res = await ask(q);
      if (res.status === 'guided') {
        if (res.result.status === 'resolved') {
          say((res.result.navigated ? 'Over here. ' : '') + purposeOf(res.match.elementId));
        } else {
          say("I know what you mean, but I can't see it on this screen right now.");
        }
      } else if (res.status === 'ambiguous') {
        say('Which of these do you mean?', res.candidates);
      } else {
        say("I couldn't find anything for that. Try describing what you want to do.");
      }
    } finally {
      setBusy(false);
    }
  };

  const choose = async (c: IntentMatch) => {
    setBusy(true);
    try {
      const r = await guide(c.elementId);
      say(
        r.status === 'resolved'
          ? (r.navigated ? 'Over here. ' : '') + purposeOf(c.elementId)
          : "I can't see that on this screen right now.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <style>{WIDGET_CSS}</style>

      {open && (
        <div
          className={`pt-panel ${side}`}
          data-pointto-panel=""
          role="dialog"
          aria-label={title}
          style={{ zIndex }}
        >
          <div className="pt-head">
            <strong>{title}</strong>
            <button type="button" className="pt-exit" data-pointto-exit="" onClick={close}>
              Exit
            </button>
          </div>

          <div className="pt-transcript" data-pointto-transcript="" ref={transcriptRef} aria-live="polite">
            {turns.length === 0 && (
              <div className="pt-empty">Ask me where something is, and I&apos;ll point at it.</div>
            )}
            {turns.map((t, i) => (
              <div key={i} className={`pt-turn ${t.role === 'user' ? 'pt-user' : 'pt-agent'}`}>
                {t.text}
                {t.choices && (
                  <div className="pt-chips">
                    {t.choices.map((c) => (
                      <button
                        key={c.elementId}
                        type="button"
                        className="pt-chip"
                        data-pointto-choice={c.elementId}
                        onClick={() => choose(c)}
                        disabled={busy}
                      >
                        {purposeOf(c.elementId)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          <form className="pt-form" onSubmit={submit}>
            <input
              ref={inputRef}
              className="pt-input"
              data-pointto-input=""
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={placeholder}
              aria-label="Your question"
              disabled={busy}
            />
            <button type="submit" className="pt-send" disabled={busy || !query.trim()}>
              Ask
            </button>
          </form>
        </div>
      )}

      <button
        type="button"
        className={`pt-trigger ${side}`}
        data-pointto-trigger=""
        aria-label={open ? 'Close guide' : 'Open guide'}
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
        style={{ zIndex }}
      >
        {open ? '×' : '?'}
      </button>
    </>
  );
}
