import { useEffect, useState } from 'react';
import type { Participant } from '../types';
import CertShare from './CertShare';

/* ============================================================================
   The certificate.
   ----------------------------------------------------------------------------
   No longer drawn on a canvas: it is a ready-made image kept in the /public
   folder. Put your file at  public/certificate.png  (or change CERT_IMAGE
   below to match your file name). Everyone sees and downloads that same image.
   ========================================================================== */

interface Props {
  participant: Participant;
  onImageGenerated?: (url: string) => void;
}

const CERT_IMAGE = '/certificate.png';

export default function CertificateRenderer({ participant, onImageGenerated }: Props) {
  const [dataUrl, setDataUrl] = useState('');
  const [failed, setFailed] = useState(false);
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

  // Load the image once and keep it as a data URL, so the download and the
  // share card use exactly the same bytes that are on screen.
  useEffect(() => {
    let alive = true;
    fetch(CERT_IMAGE)
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.blob(); })
      .then((blob) => new Promise<string>((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(String(fr.result));
        fr.onerror = () => rej(fr.error);
        fr.readAsDataURL(blob);
      }))
      .then((url) => { if (!alive) return; setDataUrl(url); onImageGenerated?.(url); })
      .catch((e) => { console.error('Certificate image failed to load:', e); if (alive) setFailed(true); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function download() {
    if (!dataUrl) return;
    if (isIOS) {
      const win = window.open('', '_blank');
      if (win) {
        win.document.write(`<html><head><title>Save Certificate</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#000;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh}img{max-width:100%;height:auto}p{color:#fff;font-family:monospace;font-size:14px;margin-top:16px;text-align:center;padding:0 16px}</style></head><body><img src="${dataUrl}"/><p>Press and hold the image, then choose Save to Photos.</p></body></html>`);
        win.document.close();
      }
      return;
    }
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `SIH-2026-Certificate-${participant.name.replace(/\s+/g, '-')}.png`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  }

  return (
    <div id="certificate-viewer" className="space-y-5">
      <figure className="cert-frame">
        <div className="cert-frame__inner">
          {dataUrl ? (
            <img
              src={dataUrl}
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
                  <span>Loading your certificate…</span>
                </>
              )}
            </div>
          )}
        </div>
      </figure>

      <CertShare event="sih" participant={participant} onDownload={download} />
    </div>
  );
}
