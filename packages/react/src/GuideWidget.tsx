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
  role: 'user' | 'agent' | 'system';
  text: string;
  /** Present on an ambiguous reply: the choices offered. */
  choices?: IntentMatch[];
}

/**
 * The widget. Text always works. Voice is a mic button that appears only when
 * the provider has voice config, and the microphone opens only when it is
 * pressed — never on open, never in the background (BUILD-SPEC 5.5).
 *
 * With a voice session open, typed text goes through the same agent, so text
 * and voice share one brain. With no session, the local lexical resolver is
 * the floor that always works.
 */
export function GuideWidget({
  position = 'bottom-right',
  title = 'Ask where',
  placeholder = 'How do I…',
  zIndex = 2147483001,
}: GuideWidgetProps) {
  const { ask, guide, manifest, clear, voiceEnabled, voiceState, startVoice, stopVoice, sendText, onAgentEvent } =
    useGuide();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [partial, setPartial] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);

  const side = position === 'bottom-left' ? 'pt-left' : 'pt-right';
  const live = voiceState === 'listening' || voiceState === 'speaking' || voiceState === 'ready';
  const connecting = voiceState === 'connecting';

  const close = useCallback(() => {
    setOpen(false);
    stopVoice();
    clear();
  }, [clear, stopVoice]);

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
  }, [turns, partial]);

  const say = useCallback(
    (text: string, choices?: IntentMatch[]) =>
      setTurns((t) => [...t, { role: 'agent', text, ...(choices ? { choices } : {}) }]),
    [],
  );

  // Live transcript from the agent. Final transcripts become turns; partial
  // user speech shows as a faint in-progress line.
  useEffect(
    () =>
      onAgentEvent((e) => {
        switch (e.type) {
          case 'transcript.user.delta':
            setPartial(String(e.text ?? e.delta ?? ''));
            break;
          case 'transcript.user':
            setPartial('');
            setTurns((t) => [...t, { role: 'user', text: String(e.text ?? '') }]);
            break;
          case 'transcript.agent':
            say(String(e.text ?? ''));
            break;
          case 'mic.unavailable':
            setTurns((t) => [
              ...t,
              { role: 'system', text: "I can't use your microphone, but you can keep typing — I'm still listening here." },
            ]);
            break;
          case 'error':
            setTurns((t) => [...t, { role: 'system', text: `Voice stopped: ${String(e.message ?? 'unknown error')}` }]);
            break;
        }
      }),
    [onAgentEvent, say],
  );

  const purposeOf = (id: string) =>
    (manifest && findElementById(manifest, id)?.purpose) || 'Here it is.';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q || busy) return;
    setQuery('');

    // A live agent understands intent and any language; it also speaks. Prefer it.
    if (live && sendText(q)) {
      setTurns((t) => [...t, { role: 'user', text: q }]);
      return;
    }

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

  const toggleMic = async () => {
    if (live || connecting) {
      stopVoice();
      return;
    }
    try {
      await startVoice();
    } catch (err) {
      setTurns((t) => [...t, { role: 'system', text: `Couldn't start voice: ${(err as Error).message}` }]);
    }
  };

  const statusText = connecting
    ? 'Connecting…'
    : voiceState === 'listening'
      ? 'Listening'
      : voiceState === 'speaking'
        ? 'Speaking'
        : voiceState === 'ready'
          ? 'Ready'
          : null;

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
            <span className="pt-status" data-pointto-status="">
              {statusText && (
                <>
                  <span className={`pt-dot ${voiceState === 'listening' ? 'pt-dot-live' : ''}`} /> {statusText}
                </>
              )}
            </span>
            <button type="button" className="pt-exit" data-pointto-exit="" onClick={close}>
              Exit
            </button>
          </div>

          <div className="pt-transcript" data-pointto-transcript="" ref={transcriptRef} aria-live="polite">
            {turns.length === 0 && !partial && (
              <div className="pt-empty">
                Ask me where something is, and I&apos;ll point at it.
                {voiceEnabled && ' Press the mic to talk.'}
              </div>
            )}
            {turns.map((t, i) => (
              <div
                key={i}
                className={`pt-turn ${t.role === 'user' ? 'pt-user' : t.role === 'system' ? 'pt-system' : 'pt-agent'}`}
              >
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
            {partial && (
              <div className="pt-turn pt-user pt-partial" data-pointto-partial="">
                {partial}
              </div>
            )}
          </div>

          <form className="pt-form" onSubmit={submit}>
            {voiceEnabled && (
              <button
                type="button"
                className={`pt-mic ${live ? 'pt-mic-live' : ''}`}
                data-pointto-mic=""
                aria-label={live ? 'Stop voice' : 'Start voice'}
                aria-pressed={live}
                onClick={toggleMic}
                disabled={connecting}
                title={live ? 'Stop' : 'Talk'}
              >
                {live ? '■' : '🎤'}
              </button>
            )}
            <input
              ref={inputRef}
              className="pt-input"
              data-pointto-input=""
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={live ? 'Or type here…' : placeholder}
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
