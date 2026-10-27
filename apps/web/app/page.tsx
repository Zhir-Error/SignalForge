import Link from "next/link";
import { SignalFlowDemo } from "./signal-flow-demo";
import { SignalForgeLogo } from "./signalforge-logo";

const workflow = [
  {
    number: "01",
    title: "Catch the signal",
    description:
      "Project-scoped event keys bring structured errors into a shared timeline.",
    tone: "orange",
  },
  {
    number: "02",
    title: "Find the pattern",
    description:
      "Matching events become an incident, with deployments shown as context.",
    tone: "blue",
  },
  {
    number: "03",
    title: "Follow the evidence",
    description:
      "Investigations work from persisted evidence and validated references.",
    tone: "violet",
  },
  {
    number: "04",
    title: "Record the recovery",
    description: "Registered checks report the assertions that actually ran.",
    tone: "mint",
  },
];

export default function Home() {
  return (
    <main className="landing-page">
      <div className="landing-aurora landing-aurora--one" aria-hidden="true" />
      <div className="landing-aurora landing-aurora--two" aria-hidden="true" />

      <header className="landing-header">
        <Link href="/" className="landing-brand" aria-label="SignalForge home">
          <SignalForgeLogo markClassName="landing-brand__mark" />
        </Link>
        <nav className="landing-nav" aria-label="Main navigation">
          <a className="landing-nav__link" href="#workflow">
            The workflow
          </a>
          <a className="landing-nav__link" href="#principles">
            Why SignalForge
          </a>
          <Link className="landing-nav__cta" href="/app">
            Open workspace <span aria-hidden="true">↗</span>
          </Link>
        </nav>
      </header>

      <section className="landing-hero">
        <div className="landing-hero__copy">
          <div className="landing-kicker">
            <span /> INCIDENT RESPONSE, WITH RECEIPTS
          </div>
          <h1>
            When production
            <br />
            gets loud, find the
            <br />
            <span className="landing-title-gradient">signal in it.</span>
          </h1>
          <p className="landing-hero__lede">
            Bring errors, changes, and recovery checks into one clear line of
            sight. Follow each investigation from the first event to the result
            you can actually prove.
          </p>
          <div className="landing-hero__actions">
            <Link
              className="landing-button landing-button--primary"
              href="/app"
            >
              Enter the workspace <span aria-hidden="true">→</span>
            </Link>
            <a
              className="landing-button landing-button--quiet"
              href="#workflow"
            >
              See how it works <span aria-hidden="true">↓</span>
            </a>
          </div>
          <div className="landing-proofline">
            <span>
              <i /> EVIDENCE STAYS TRACEABLE
            </span>
            <span>
              <i /> CHECKS STAY CONTROLLED
            </span>
          </div>
        </div>
        <div className="landing-hero__visual">
          <div className="hero-orbit hero-orbit--outer" />
          <div className="hero-orbit hero-orbit--inner" />
          <SignalFlowDemo />
          <span className="landing-visual-note">
            A clearer path through the incident
          </span>
        </div>
        <div className="landing-scroll-cue" aria-hidden="true">
          <span /> SCROLL TO FOLLOW THE SIGNAL
        </div>
      </section>

      <section id="workflow" className="landing-workflow">
        <div className="landing-section-heading">
          <p className="landing-eyebrow">A calmer way through the noise</p>
          <h2>One incident. A complete line of sight.</h2>
          <p>
            Keep observations, explanations, and outcomes connected, while
            keeping their meaning clear.
          </p>
        </div>
        <div className="workflow-grid">
          {workflow.map((step) => (
            <article
              className={`workflow-card workflow-card--${step.tone}`}
              key={step.number}
            >
              <div className="workflow-card__number">{step.number}</div>
              <div className="workflow-card__icon" aria-hidden="true">
                {step.number === "01"
                  ? "⌁"
                  : step.number === "02"
                    ? "◌"
                    : step.number === "03"
                      ? "⌕"
                      : "✓"}
              </div>
              <h3>{step.title}</h3>
              <p>{step.description}</p>
              <span className="workflow-card__line" aria-hidden="true" />
            </article>
          ))}
        </div>
      </section>

      <section id="principles" className="landing-principles">
        <div className="principles-copy">
          <p className="landing-eyebrow">Trust the trail, not the guess</p>
          <h2>
            Useful context.
            <br />
            <span>Honest conclusions.</span>
          </h2>
          <p>
            A nearby deployment is a clue, not a verdict. A passing scenario
            applies to the check that ran. SignalForge keeps those boundaries
            visible while your team works.
          </p>
          <Link className="principles-link" href="/app">
            Explore the workspace <span>→</span>
          </Link>
        </div>
        <div className="principles-stack">
          <article className="principle-card">
            <span className="principle-card__index">A / SOURCE</span>
            <div className="principle-card__glyph principle-card__glyph--orange">
              ⌁
            </div>
            <div>
              <h3>Evidence with a source</h3>
              <p>
                Findings refer back to stored events and investigation evidence.
              </p>
            </div>
          </article>
          <article className="principle-card">
            <span className="principle-card__index">B / SCOPE</span>
            <div className="principle-card__glyph principle-card__glyph--blue">
              ◈
            </div>
            <div>
              <h3>Access with boundaries</h3>
              <p>
                Organizations, projects, and keys keep their intended scope.
              </p>
            </div>
          </article>
          <article className="principle-card">
            <span className="principle-card__index">C / RESULT</span>
            <div className="principle-card__glyph principle-card__glyph--mint">
              ✓
            </div>
            <div>
              <h3>Checks with a record</h3>
              <p>
                Registered scenarios show their assertions and actual outcomes.
              </p>
            </div>
          </article>
        </div>
      </section>

      <section className="landing-cta-band">
        <div className="cta-mark">
          <SignalForgeLogo compact markClassName="cta-mark__svg" />
        </div>
        <div>
          <p>THE NEXT SIGNAL IS ALREADY ON ITS WAY</p>
          <h2>Meet it with a little more clarity.</h2>
        </div>
        <Link className="landing-button landing-button--primary" href="/app">
          Open SignalForge <span>→</span>
        </Link>
      </section>

      <footer className="landing-footer">
        <Link href="/" aria-label="SignalForge home">
          <SignalForgeLogo markClassName="landing-footer__mark" />
        </Link>
        <span>Built for the moments between alert and understanding.</span>
        <Link href="/app">
          Go to workspace <span aria-hidden="true">↗</span>
        </Link>
      </footer>
    </main>
  );
}
