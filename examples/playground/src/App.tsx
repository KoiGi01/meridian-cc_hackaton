import { useGuide } from 'pointto';
import { useState, type CSSProperties } from 'react';

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
  alignItems: 'center',
  position: 'sticky',
  top: 0,
  background: '#fafafa',
  padding: '12px 0',
  zIndex: 10,
};

const readout: CSSProperties = {
  font: '13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace',
  background: '#18181b',
  color: '#e4e4e7',
  borderRadius: 8,
  padding: '10px 14px',
  margin: '8px 0 0',
};

export function App() {
  const { lastOutcome } = useGuide();
  const [clicks, setClicks] = useState(0);

  // The two ways a host app breaks a manifest: the test id disappears in a
  // refactor, and the visible label gets reworded by a designer.
  const [testIdBroken, setTestIdBroken] = useState(false);
  const [renamed, setRenamed] = useState(false);
  const [removed, setRemoved] = useState(false);

  const inviteProps = testIdBroken ? {} : { 'data-testid': 'invite-member-btn' };

  return (
    <main style={{ font: '16px/1.5 system-ui, sans-serif', maxWidth: 760, margin: '0 auto', padding: 24 }}>
      <h1>pointto playground</h1>
      <p>
        Checkpoint 3. Open the widget (the <strong>?</strong> button, bottom right) and ask it something in
        plain words — try <em>how do I invite someone?</em> or <em>where is billing?</em>
      </p>

      <div style={bar}>
        <strong style={{ font: '13px system-ui' }}>Break the manifest:</strong>
        <label>
          <input type="checkbox" checked={testIdBroken} onChange={(e) => setTestIdBroken(e.target.checked)} />{' '}
          remove its test id
        </label>
        <label>
          <input type="checkbox" checked={renamed} onChange={(e) => setRenamed(e.target.checked)} /> rename the
          button
        </label>
        <label>
          <input type="checkbox" checked={removed} onChange={(e) => setRemoved(e.target.checked)} /> delete it
          entirely
        </label>
      </div>

      <pre style={readout} data-testid="outcome-readout">
        {lastOutcome === null
          ? 'No request yet. Ask the widget something.'
          : lastOutcome.status === 'resolved'
            ? `resolved   anchor: ${lastOutcome.anchorKind}  (position ${lastOutcome.anchorIndex} in the cascade)${
                lastOutcome.ambiguous ? '  AMBIGUOUS: more than one match' : ''
              }`
            : `not found  tried: ${lastOutcome.tried.join(' -> ') || '(id is not in the manifest)'}\nNothing is lit, which is correct: we never guess.`}
      </pre>

      <section style={panel}>
        <h2>Proof the host UI stays clickable</h2>
        <p>
          This counter must still increment while the screen is dimmed. Clicked{' '}
          <strong data-testid="click-count">{clicks}</strong> times.
        </p>
        <button onClick={() => setClicks((c) => c + 1)}>Click me while dimmed</button>
      </section>

      <div style={{ height: '70vh' }} aria-hidden />

      <section style={panel} id="team-panel">
        <h2>Team settings</h2>
        {removed ? (
          <p style={{ color: '#71717a' }}>The button has been deleted from the page.</p>
        ) : (
          <button {...inviteProps}>{renamed ? 'Add a teammate' : 'Invite member'}</button>
        )}
      </section>

      <div style={{ height: '70vh' }} aria-hidden />

      <section style={panel} id="billing-panel">
        <h2>Billing</h2>
        <button data-testid="billing-btn">Manage billing</button>
      </section>

      <div style={{ height: '40vh' }} aria-hidden />
    </main>
  );
}
