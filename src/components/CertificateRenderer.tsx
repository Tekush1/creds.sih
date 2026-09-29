import { useCallback, useEffect, useRef, useState } from 'react';
import type { Participant } from '../types';
import CertShare from './CertShare';

/* ============================================================================
   The certificate.
   ----------------------------------------------------------------------------
   Drawn entirely on a canvas, so it needs no artwork file: a tricolour
   border, the title for the round, the name the person confirmed, their team,
   and the credential ID with the address where it can be checked.

   The exported image is what the person downloads and posts; the on-page
   copy is that same image. Sized 2000 x 1414 (A4 landscape).
   ========================================================================== */

interface Props {
  participant: Participant;
  onImageGenerated?: (url: string) => void;
}

const W = 2000;
const H = 1414;

const SAFFRON = '#FF9933';
const NAVY    = '#12285C';
const GREEN   = '#138808';
const INK     = '#141821';
const MUTED   = '#5A6377';
const PAPER   = '#FBF8F1';

const SCRIPT = '"Great Vibes", "Alex Brush", cursive';
const SERIF  = '"Playfair Display", "Times New Roman", serif';
const SANS   = '"Space Grotesk", "Inter", sans-serif';
const MONO   = '"JetBrains Mono", monospace';

export default function CertificateRenderer({ participant, onImageGenerated }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [downloadUrl, setDownloadUrl] = useState('');
  const [fontGen, setFontGen] = useState(0);
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const finals = participant.certificateType === 'grandfinale';

  // Ask for the faces the drawing uses, and redraw whenever one arrives, so
  // the first paint never settles on a fallback font.
  useEffect(() => {
    if (!document.fonts) return;
    const bump = () => setFontGen((n) => n + 1);
    document.fonts.addEventListener('loadingdone', bump);
    Promise.all([
      document.fonts.load('120px "Great Vibes"'),
      document.fonts.load('700 60px "Playfair Display"'),
      document.fonts.load('400 30px "Playfair Display"'),
      document.fonts.load('500 30px "Space Grotesk"'),
      document.fonts.load('600 30px "Space Grotesk"'),
      document.fonts.load('500 30px "JetBrains Mono"'),
    ]).then(bump).catch(bump);
    return () => document.fonts.removeEventListener('loadingdone', bump);
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.width = W;
    canvas.height = H;

    // Paper
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, W, H);

    // Tricolour border: saffron outside, navy rule, green inside
    ctx.lineWidth = 16; ctx.strokeStyle = SAFFRON; ctx.strokeRect(40, 40, W - 80, H - 80);
    ctx.lineWidth = 4;  ctx.strokeStyle = NAVY;    ctx.strokeRect(74, 74, W - 148, H - 148);
    ctx.lineWidth = 16; ctx.strokeStyle = GREEN;   ctx.strokeRect(96, 96, W - 192, H - 192);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    const cx = W / 2;

    // Event
    ctx.fillStyle = NAVY;
    ctx.font = `600 34px ${SANS}`;
    spaced(ctx, 'SMART INDIA HACKATHON 2026', cx, 250, 10);

    // Title
    ctx.fillStyle = INK;
    ctx.font = `700 92px ${SERIF}`;
    ctx.fillText(finals ? 'CERTIFICATE OF ACHIEVEMENT' : 'CERTIFICATE OF PARTICIPATION', cx, 400);

    // Divider
    ctx.fillStyle = SAFFRON; ctx.fillRect(cx - 160, 446, 320, 6);

    ctx.fillStyle = MUTED;
    ctx.font = `400 italic 40px ${SERIF}`;
    ctx.fillText('This certificate is proudly presented to', cx, 560);

    // Name: as large as fits, never wider than the line under it
    const name = participant.name;
    const maxW = 1350;
    let size = 190;
    ctx.font = `${size}px ${SCRIPT}`;
    const w0 = ctx.measureText(name).width;
    if (w0 > maxW) size = Math.max(70, Math.floor(size * (maxW / w0)));
    ctx.font = `${size}px ${SCRIPT}`;
    ctx.fillStyle = NAVY;
    ctx.fillText(name, cx, 770);

    ctx.strokeStyle = INK; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx - 640, 812); ctx.lineTo(cx + 640, 812); ctx.stroke();

    // Body
    ctx.fillStyle = INK;
    ctx.font = `400 40px ${SERIF}`;
    const line1 = finals
      ? 'for reaching the Grand Finale of the Smart India Hackathon 2026'
      : 'for participating in the Smart India Hackathon 2026';
    ctx.fillText(line1, cx, 900);
    ctx.fillStyle = MUTED;
    ctx.font = `400 34px ${SERIF}`;
    ctx.fillText('a national hackathon by the Ministry of Education\u2019s Innovation Cell and AICTE', cx, 956);

    // Team
    ctx.fillStyle = INK;
    ctx.font = `500 36px ${SANS}`;
    const team = clip(ctx, `Team  \u2022  ${participant.team}`, 1300);
    ctx.fillText(team, cx, 1060);

    // Footer: credential ID and where to check it
    ctx.fillStyle = MUTED;
    ctx.font = `500 22px ${SANS}`;
    spaced(ctx, 'CREDENTIAL ID', cx, 1200, 5);
    ctx.fillStyle = INK;
    ctx.font = `500 38px ${MONO}`;
    ctx.fillText(participant.id, cx, 1250);
    ctx.fillStyle = MUTED;
    ctx.font = `400 24px ${SANS}`;
    ctx.fillText(`Verify at ${window.location.host}/verify`, cx, 1296);

    try {
      const url = canvas.toDataURL('image/png');
      setDownloadUrl(url);
      onImageGenerated?.(url);
    } catch (e) {
      console.error('Canvas export failed:', e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [participant, finals]);

  useEffect(() => { draw(); }, [draw, fontGen]);

  function download() {
    if (!downloadUrl) return;
    if (isIOS) {
      const win = window.open('', '_blank');
      if (win) {
        win.document.write(`<html><head><title>Save Certificate</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#000;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh}img{max-width:100%;height:auto}p{color:#fff;font-family:monospace;font-size:14px;margin-top:16px;text-align:center;padding:0 16px}</style></head><body><img src="${downloadUrl}"/><p>Press and hold the image, then choose Save to Photos.</p></body></html>`);
        win.document.close();
      }
      return;
    }
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = `SIH-2026-Certificate-${participant.name.replace(/\s+/g, '-')}.png`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  }

  return (
    <div id="certificate-viewer" className="space-y-5">
      <figure className="cert-frame">
        <div className="cert-frame__inner" style={{ aspectRatio: `${W} / ${H}` }}>
          {downloadUrl ? (
            <img
              src={downloadUrl}
              alt={`Smart India Hackathon 2026 certificate for ${participant.name}`}
              className="w-full h-auto object-contain select-none"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="cert-frame__loading">
              <span className="spinner" aria-hidden="true" />
              <span>Rendering your certificate…</span>
            </div>
          )}
        </div>
      </figure>

      <canvas ref={canvasRef} className="hidden" />

      <CertShare event="sih" participant={participant} onDownload={download} />
    </div>
  );
}

/** Letter-spaced, centred text, drawn a glyph at a time so it behaves the
 *  same in every browser. */
function spaced(ctx: CanvasRenderingContext2D, text: string, cx: number, y: number, track: number) {
  const chars = [...text];
  const widths = chars.map((c) => ctx.measureText(c).width);
  const total = widths.reduce((a, b) => a + b, 0) + track * (chars.length - 1);
  const align = ctx.textAlign;
  ctx.textAlign = 'left';
  let x = cx - total / 2;
  chars.forEach((c, i) => { ctx.fillText(c, x, y); x += widths[i] + track; });
  ctx.textAlign = align;
}

/** Trim with an ellipsis so a very long team name stays inside the border. */
function clip(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '\u2026').width > maxW) t = t.slice(0, -1);
  return t.trimEnd() + '\u2026';
}
