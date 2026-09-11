import { useGuide } from "@pointto/react";
import { useState } from "react";

/**
 * OUR CODE, not Refine's. A temporary QA harness for checkpoint 2.
 *
 * The real trigger for all of this is the voice widget, which arrives in a
 * later checkpoint. Until then a tester needs some way to ask for an element by
 * manifest id, and to see which anchor actually resolved it. This panel is
 * deleted once the widget exists.
 */
const ELEMENT_IDS = [
  "products.nav",
  "products.create",
  "stores.nav",
  "stores.create",
  "dashboard.nav",
  "orders.nav",
];

export function PointtoQaPanel() {
  const { spotlightId, clear, lastOutcome } = useGuide();
  const [open, setOpen] = useState(true);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{ ...shell, width: "auto", padding: "8px 12px" }}
      >
        pointto QA
      </button>
    );
  }

  return (
    <div style={shell}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
        <strong>pointto QA panel</strong>
        <button onClick={() => setOpen(false)} style={linkish}>
          hide
        </button>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
        {ELEMENT_IDS.map((id) => (
          <button key={id} onClick={() => spotlightId(id)} style={chip}>
            {id}
          </button>
        ))}
        <button onClick={clear} style={{ ...chip, borderColor: "#71717a" }}>
          clear
        </button>
      </div>

      <pre style={readout} data-testid="pointto-outcome">
        {lastOutcome === null
          ? "Pick an element id above."
          : lastOutcome.status === "resolved"
            ? `resolved via ${lastOutcome.anchorKind} (position ${lastOutcome.anchorIndex})${
                lastOutcome.ambiguous ? "  AMBIGUOUS" : ""
              }`
            : `not found — tried ${lastOutcome.tried.join(" -> ") || "(unknown id)"}\nnothing lit, which is correct`}
      </pre>
    </div>
  );
}

const shell: React.CSSProperties = {
  position: "fixed",
  right: 16,
  bottom: 16,
  zIndex: 2147483100,
  width: 380,
  background: "#18181b",
  color: "#e4e4e7",
  border: "1px solid #3f3f46",
  borderRadius: 10,
  padding: 12,
  font: "12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace",
  boxShadow: "0 8px 24px rgba(0,0,0,.35)",
};

const chip: React.CSSProperties = {
  background: "#27272a",
  color: "#e4e4e7",
  border: "1px solid #52525b",
  borderRadius: 6,
  padding: "4px 8px",
  cursor: "pointer",
  font: "inherit",
};

const linkish: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "#a1a1aa",
  cursor: "pointer",
  font: "inherit",
};

const readout: React.CSSProperties = {
  margin: 0,
  whiteSpace: "pre-wrap",
  color: "#d4d4d8",
};
