import { useEffect } from 'react';
import { EVENTS } from '../data/events';
import EventCard from '../components/EventCard';
import { useBench } from '../three/BenchProvider';

/* ============================================================================
   Landing — an index, not a pitch.
   ----------------------------------------------------------------------------
   Everyone here already took part, so there is one thing to do on arrival:
   pick the event and claim. Checking a certificate has its own page, reached
   from the header and the footer; a second copy of that form here only
   competed with the events for attention.

   The hero sits on one centre axis — chip, both lines of the headline, the
   intro — so nothing has to be optically lined up against anything else.
   ========================================================================== */

export default function Landing() {
  const { setState, setMineral, setSpecimen, setEtchMask } = useBench();

  useEffect(() => {
    // Nothing has been claimed here, so there is no specimen and no name to
    // etch. Each card carries its own mineral rather than colouring the whole
    // page for one of two events.
    setSpecimen(null);
    setEtchMask(null);
    setMineral('neutral');
    setState('FRACTURE');
  }, [setState, setMineral, setSpecimen, setEtchMask]);

  const R = (i: number) => ({ '--i': i }) as React.CSSProperties;

  return (
    <div className="above-bench mx-auto max-w-6xl px-5 sm:px-6">
      <section className="hero">
        <span className="chip reveal" data-live style={{ ...R(0), '--dot': 'var(--color-brand)' } as React.CSSProperties}>
          <span className="chip__dot" />
          Official certificates &middot; 2026
        </span>

        <h1 className="hero__title">
          <span className="reveal" style={R(1)}>Every idea you built,</span>{' '}
          <em className="reveal" style={R(2)}>now on the record.</em>
        </h1>

        <p className="hero__lede reveal" style={R(3)}>
          Official certificates for the Smart India Hackathon. Choose the event,
          enter your email, and download your certificate.
        </p>
      </section>

      <div className="section-head reveal" style={R(4)}>
        <span className="section-head__rule" aria-hidden="true" />
        <h2 className="section-head__title">Choose your event</h2>
        <span className="section-head__rule section-head__rule--r" aria-hidden="true" />
      </div>

      {/* pt-9 is the room the planets need: each one rises through the top
          edge of its card. .events-stage reserves the room the certificate
          needs below the cards when it prints — only where hover exists. */}
      <section className="events-stage grid items-stretch gap-x-6 gap-y-14 pt-9 sm:grid-cols-2 sm:[&>*:only-child]:col-span-2 sm:[&>*:only-child]:mx-auto sm:[&>*:only-child]:w-full sm:[&>*:only-child]:max-w-xl" style={{ '--base': '420ms' } as React.CSSProperties}>
        {/* Open events first: the one people should be claiming leads. */}
        {Object.values(EVENTS)
          .sort((a, b) => Number(b.is_active) - Number(a.is_active))
          .map((ev, i) => <EventCard key={ev.key} ev={ev} order={i} />)}
      </section>
    </div>
  );
}
