import { useState } from 'react';
import type { Participant } from '../types';

/* ============================================================================
   Sharing a certificate.
   ----------------------------------------------------------------------------
   One panel for every event. It shows the caption it will copy, in full, so
   nobody posts text they have not read: a title, a line about the event, the
   team, the credential ID and the verification link, then the hashtags.
   Below it, the three things a person actually does with a new certificate:
   put it on their LinkedIn profile (the Certifications form, prefilled, with
   the verification link attached), post it to Instagram, or download it.

   Everything said here is true. The certificate is verifiable because anyone
   can look its ID up on this site — that is the claim, and the only one.
   ========================================================================== */

type EventKey = 'sih';

interface Meta {
  name: string;
  /** Certificate title, by round. */
  title: (finals: boolean) => string;
  /** The event, stated plainly, by round; `strong` spans are emphasised. */
  blurb: (finals: boolean) => { text: string; strong?: boolean }[];
  tags: string;
}

const META: Record<EventKey, Meta> = {
  sih: {
    name: 'Smart India Hackathon 2026',
    title: (finals) => (finals ? 'Grand Finale Certificate' : 'Participation Certificate'),
    blurb: (finals) => [
      ...(finals
        ? [
            { text: 'Proud to have reached the ' },
            { text: 'Grand Finale', strong: true },
            { text: ' of Smart India Hackathon 2026, ' },
          ]
        : [{ text: 'Proud to have taken part in Smart India Hackathon 2026, ' }]),
      { text: 'the national product-development hackathon by the Ministry of Education\u2019s Innovation Cell and AICTE.' },
    ],
    tags: '#SIH2026 #SmartIndiaHackathon #Hackathon #Innovation #cyberhx',
  },
};

export default function CertShare({
  event,
  participant,
  onDownload,
}: {
  event: EventKey;
  participant: Participant;
  /** The renderer's own download, which knows how to hand iOS the image. */
  onDownload: () => void;
}) {
  const m = META[event];
  const finals = participant.certificateType === 'grandfinale';
  const heading = `${m.name} — ${m.title(finals)}`;
  const blurb = m.blurb(finals);
  const [toast, setToast] = useState('');
  const [copied, setCopied] = useState(false);
  const verifyUrl = `${window.location.origin}/verify?id=${participant.id}`;
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

  const details: [string, string][] = [
    ['Team', participant.team],
    ...(participant.rank != null ? [['Rank', `#${participant.rank}`] as [string, string]] : []),
    ['Event', m.name],
    ['Credential ID', participant.id],
  ];

  const caption =
    `🚩 ${heading}\n\n` +
    `${blurb.map((b) => b.text).join('')}\n\n` +
    details.map(([k, v]) => `${k}: ${v}`).join('\n') + '\n' +
    `Verify: ${verifyUrl}\n\n` +
    m.tags;

  function say(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(''), 3600);
  }

  function copy(after?: string) {
    return navigator.clipboard.writeText(caption).then(
      () => { setCopied(true); window.setTimeout(() => setCopied(false), 2200); if (after) say(after); return true; },
      () => { say('Could not reach the clipboard. Select the caption and copy it.'); return false; },
    );
  }

  function linkedIn() {
    const d = new Date(participant.issuedAt);
    const params = new URLSearchParams({
      startTask: 'CERTIFICATION_NAME',
      name: `${m.name} ${m.title(finals)}`,
      organizationName: 'CyberHx',
      organizationId: '107736778',
      issueYear: String(d.getFullYear() || 2026),
      issueMonth: String((d.getMonth() + 1) || 1),
      certUrl: verifyUrl,
      certId: participant.id,
    });
    copy();
    window.open(`https://www.linkedin.com/profile/add?${params.toString()}`, '_blank', 'noopener,noreferrer');
    say('LinkedIn is opening with the form filled in. Review it and save. The caption is copied for a post, too.');
  }

  function instagram() {
    copy();
    onDownload();
    if (isIOS) {
      say('Caption copied. Save the image, then paste the caption in Instagram.');
      window.setTimeout(() => { window.location.href = 'instagram://app'; }, 1200);
      return;
    }
    say('Caption copied and certificate downloaded. Post the image and paste the caption.');
  }

  return (
    <div className="panel share">
      <div>
        <h3 className="share__title">Share your achievement</h3>
        <p className="share__sub">
          The verification link goes with it, so anyone can confirm it's yours.
        </p>
      </div>

      {/* The caption, exactly as it will be copied */}
      <div className="share__caption">
        <div className="share__caption-bar">
          <span className="share__caption-label">Your caption</span>
          <button type="button" onClick={() => copy('Caption copied.')} className="share__copy">
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8" fill="none" stroke="currentColor" strokeWidth="1.8" /></svg>
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <div className="share__caption-body">
          <p className="share__caption-title"><span aria-hidden="true">🚩</span> {heading}</p>
          <p className="share__caption-blurb">
            {blurb.map((b, i) => (b.strong ? <strong key={i}>{b.text}</strong> : <span key={i}>{b.text}</span>))}
          </p>
          <dl className="share__caption-facts">
            {details.map(([k, v]) => (
              <div key={k}>
                <dt>{k}:</dt>
                <dd className={k === 'Credential ID' ? 'is-id' : undefined}>{v}</dd>
              </div>
            ))}
            <div>
              <dt>Verify:</dt>
              <dd><a href={verifyUrl} target="_blank" rel="noopener noreferrer">{verifyUrl}</a></dd>
            </div>
          </dl>
          <p className="share__caption-tags">{m.tags}</p>
        </div>
      </div>

      <div className="share__main">
        <button type="button" onClick={linkedIn} className="share__big share__big--linkedin">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.36V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28ZM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13ZM7.12 20.45H3.56V9h3.56v11.45ZM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0Z"/></svg>
          Add to LinkedIn profile
        </button>
        <button type="button" onClick={instagram} className="share__big share__big--instagram">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <rect x="2.5" y="2.5" width="19" height="19" rx="5.5" fill="none" stroke="currentColor" strokeWidth="2" />
            <circle cx="12" cy="12" r="4.3" fill="none" stroke="currentColor" strokeWidth="2" />
            <circle cx="17.3" cy="6.7" r="1.3" fill="currentColor" />
          </svg>
          Post to Instagram
        </button>
      </div>

      <button type="button" onClick={onDownload} className="share__download">
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19.5h14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
        Download certificate
      </button>

      <p className="share__howto">
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="m8 12.4 2.7 2.6L16.2 9.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
        <span>
          <strong>How to post:</strong> both buttons copy the caption for you. LinkedIn opens
          the Add certification form already filled in; Instagram downloads the certificate so
          you can post it and paste the caption.
          {isIOS && ' On iPhone and iPad the image opens in a new tab: press and hold it, then choose Save to Photos.'}
        </span>
      </p>

      <p className="share__toast" role="status" aria-live="polite" data-show={toast ? 'true' : undefined}>
        {toast}
      </p>
    </div>
  );
}
