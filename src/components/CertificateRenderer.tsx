import { useCallback, useEffect, useRef, useState } from 'react';
import type { Participant } from '../types';
import CertShare from './CertShare';

/* ============================================================================
   The certificate.
   ----------------------------------------------------------------------------
   The design is a ready-made image kept in /public (public/certificate.png).
   The only thing drawn on top of it is the person's name, in the blank space
   under "This certificate is proudly awarded to".

   If the name sits too high / low / wide on your image, change the three
   numbers below. They are fractions of the image, so they work for any size.
   ========================================================================== */

interface Props {
  participant: Participant;
  onImageGenerated?: (url: string) => void;
}

const CERT_IMAGE = '/certificate.png';

const NAME_Y     = 0.570;  // baseline of the name, as a fraction of image height (bigger = lower)
const NAME_SIZE  = 0.105;  // biggest font size, as a fraction of image height
const NAME_MAX_W = 0.62;   // the name is shrunk to fit inside this fraction of the width
const NAME_COLOR = '#12285C';

const SCRIPT = '"Great Vibes", "Alex Brush", cursive';

export default function CertificateRenderer({ participant, onImageGenerated }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [downloadUrl, setDownloadUrl] = useState('');
  const [fontGen, setFontGen] = useState(0);
  const [failed, setFailed] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [imgReady, setImgReady] = useState(false);
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

  // Load the template once.
  useEffect(() => {
    const img = new Image();
    img.onload = () => { imgRef.current = img; setImgReady(true); };
    img.onerror = () => setFailed(true);
    img.src = CERT_IMAGE;
  }, []);

  // Ask for the script font and redraw when it arrives, so the first paint
  // never settles on a fallback font.
  useEffect(() => {
    if (!document.fonts) return;
    const bump = () => setFontGen((n) => n + 1);
    document.fonts.addEventListener('loadingdone', bump);
    document.fonts.load('120px "Great Vibes"').then(bump).catch(bump);
    return () => document.fonts.removeEventListener('loadingdone', bump);
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = img.naturalWidth;
    const H = img.naturalHeight;
    canvas.width = W;
    canvas.height = H;
    ctx.drawImage(img, 0, 0, W, H);

    // Name: as large as fits, never wider than NAME_MAX_W of the image
    const name = (participant.name || '').trim();
    if (name) {
      let size = Math.round(H * NAME_SIZE);
      ctx.font = `${size}px ${SCRIPT}`;
      const w0 = ctx.measureText(name).width;
      const maxW = W * NAME_MAX_W;
      if (w0 > maxW) size = Math.max(Math.round(H * 0.05), Math.floor(size * (maxW / w0)));
      ctx.font = `${size}px ${SCRIPT}`;
      ctx.fillStyle = NAME_COLOR;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(name, W / 2, H * NAME_Y);
    }

    try {
      const url = canvas.toDataURL('image/png');
      setDownloadUrl(url);
      onImageGenerated?.(url);
    } catch (e) {
      console.error('Canvas export failed:', e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [participant, imgReady]);

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
        <div className="cert-frame__inner">
          {downloadUrl ? (
            <img
              src={downloadUrl}
              alt={`Smart India Hackathon 2026 certificate for ${participant.name}`}
              className="w-full h-auto object-contain select-none"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="cert-frame__loading">
              {failed ? (
                <span>Certificate image not found. Add it as public{CERT_IMAGE}.</span>
              ) : (
                <>
                  <span className="spinner" aria-hidden="true" />
                  <span>Rendering your certificate…</span>
                </>
              )}
            </div>
          )}
        </div>
      </figure>

      <canvas ref={canvasRef} className="hidden" />

      <CertShare event="sih" participant={participant} onDownload={download} />
    </div>
  );
}
