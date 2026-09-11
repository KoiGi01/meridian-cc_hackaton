import { useGuide } from '@pointto/react';
import { useRef, useState, type CSSProperties } from 'react';

const panel: CSSProperties = {
  border: '1px solid #d4d4d8',
  borderRadius: 12,
  padding: 24,
  margin: '48px 0',
  background: '#fff',
};

const bar: CSSProperties = {
  display: 'flex',
  gap: 8,
  flexWrap: 'wrap',
  position: 'sticky',
  top: 0,
  background: '#fafafa',
  padding: '12px 0',
  zIndex: 10,
};

export function App() {
  const inviteRef = useRef<HTMLButtonElement>(null);
  const billingRef = useRef<HTMLButtonElement>(null);
  const { spotlight, clear } = useGuide();
  const [clicks, setClicks] = useState(0);

  return (
    <main style={{ font: '16px/1.5 system-ui, sans-serif', maxWidth: 720, margin: '0 auto', padding: 24 }}>
      <h1>pointto playground</h1>
      <p>Phase 1 harness. No voice, no manifest — just the spotlight.</p>

      <div style={bar}>
        <button onClick={() => spotlight(inviteRef.current)}>Spotlight “Invite member”</button>
        <button onClick={() => spotlight(billingRef.current)}>Spotlight “Billing”</button>
        <button onClick={clear}>Clear</button>
      </div>

      <section style={panel}>
        <h2>Proof the host UI stays clickable</h2>
        <p>
          This counter must still increment while the screen is dimmed. Clicked{' '}
          <strong data-testid="click-count">{clicks}</strong> times.
        </p>
        <button onClick={() => setClicks((c) => c + 1)}>Click me while dimmed</button>
      </section>

      <div style={{ height: '70vh' }} aria-hidden />

      <section style={panel}>
        <h2>Team settings</h2>
        <button ref={inviteRef} data-testid="invite-member-btn">
          Invite member
        </button>
      </section>

      <div style={{ height: '70vh' }} aria-hidden />

      <section style={panel}>
        <h2>Billing</h2>
        <button ref={billingRef} data-testid="billing-btn">
          Manage billing
        </button>
      </section>

      <div style={{ height: '40vh' }} aria-hidden />
    </main>
  );
}
