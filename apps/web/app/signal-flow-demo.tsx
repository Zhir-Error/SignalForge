"use client";

import { useState } from "react";

const stages = [
  {
    label: "Ingest",
    eyebrow: "01 / SIGNAL RECEIVED",
    title: "A checkout starts to fail.",
    detail: "Structured events arrive with project-scoped credentials.",
    signal: "checkout.payment_timeout",
    time: "14:32:08.241",
  },
  {
    label: "Correlate",
    eyebrow: "02 / INCIDENT GROUPED",
    title: "Related errors find their shape.",
    detail: "Matching fingerprints gather into one incident timeline.",
    signal: "INC-204 · 18 events",
    time: "14:32:09.004",
  },
  {
    label: "Investigate",
    eyebrow: "03 / EVIDENCE ASSEMBLED",
    title: "Context stays attached to every claim.",
    detail: "The investigation cites persisted events and nearby changes.",
    signal: "evidence refs · 04",
    time: "14:32:12.686",
  },
  {
    label: "Verify",
    eyebrow: "04 / CHECK RECORDED",
    title: "A registered check tests the recovery.",
    detail: "Assertions and their actual results become the record.",
    signal: "recovery-check · passed",
    time: "14:33:01.118",
  },
];

export function SignalFlowDemo() {
  const [activeStage, setActiveStage] = useState(0);
  const stage = stages[activeStage]!;

  return (
    <section
      className="signal-demo"
      aria-label="Interactive SignalForge workflow preview"
    >
      <div className="signal-demo__topline">
        <span className="signal-demo__live">
          <i /> SYSTEMS IN VIEW
        </span>
        <span className="signal-demo__window">CHECKOUT / PRODUCTION</span>
      </div>

      <div className="signal-demo__canvas">
        <div className="signal-demo__grid" />
        <svg
          className="signal-demo__wires"
          viewBox="0 0 600 300"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path
            className="signal-demo__wire"
            d="M28 147H158C180 147 180 68 205 68H370C394 68 390 147 421 147H572"
          />
          <path
            className="signal-demo__wire signal-demo__wire--lower"
            d="M28 147H158C180 147 180 228 205 228H370C394 228 390 147 421 147H572"
          />
          <path
            className="signal-demo__pulse"
            d="M28 147H158C180 147 180 68 205 68H370C394 68 390 147 421 147H572"
          />
        </svg>
        <div className="signal-demo__node signal-demo__node--source">
          <span>01</span>
          <b>Event</b>
        </div>
        <div
          className={`signal-demo__node signal-demo__node--incident ${activeStage >= 1 ? "is-active" : ""}`}
        >
          <span>02</span>
          <b>Incident</b>
        </div>
        <div
          className={`signal-demo__node signal-demo__node--evidence ${activeStage >= 2 ? "is-active" : ""}`}
        >
          <span>03</span>
          <b>Evidence</b>
        </div>
        <div
          className={`signal-demo__node signal-demo__node--check ${activeStage >= 3 ? "is-active" : ""}`}
        >
          <span>04</span>
          <b>Check</b>
        </div>
        <div className="signal-demo__event-card" key={activeStage}>
          <div className="signal-demo__event-heading">
            <span>{stage.eyebrow}</span>
            <span className="signal-demo__event-time">{stage.time}</span>
          </div>
          <h2>{stage.title}</h2>
          <p>{stage.detail}</p>
          <div className="signal-demo__event-footer">
            <code>{stage.signal}</code>
            <span>● VERIFIED FLOW</span>
          </div>
        </div>
      </div>

      <div
        className="signal-demo__controls"
        role="group"
        aria-label="Workflow stages"
      >
        {stages.map((item, index) => (
          <button
            key={item.label}
            type="button"
            aria-pressed={activeStage === index}
            onClick={() => setActiveStage(index)}
            className={activeStage === index ? "is-active" : ""}
          >
            <span>{String(index + 1).padStart(2, "0")}</span>
            {item.label}
          </button>
        ))}
      </div>
      <span id="signal-demo-stage" className="sr-only" aria-live="polite">
        {stage.label}: {stage.title} {stage.detail}
      </span>
    </section>
  );
}
