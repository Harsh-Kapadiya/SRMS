'use client';
import { useEffect, useRef, useState } from 'react';
import { Alert, Modal } from '@srms/ui-kit';
import { useI18n } from '@/lib/dealer-i18n';

// Browser-native QR reading (Shape Detection API). Not yet in TypeScript's DOM types.
type Detector = { detect(source: CanvasImageSource): Promise<{ rawValue: string }[]> };
declare global {
  interface Window {
    BarcodeDetector?: new (options: { formats: string[] }) => Detector;
  }
}

/**
 * True where the camera can read QR codes: Chrome on Android (what shop phones use) and macOS.
 * ponytail: no JS decoder — typing the 12-digit card number works everywhere; add one
 * (e.g. jsQR) if dealers on iPhones or Windows webcams need scanning.
 */
export function useQrSupported() {
  const [ok, setOk] = useState(false);
  useEffect(() => setOk(typeof window.BarcodeDetector === 'function' && Boolean(navigator.mediaDevices?.getUserMedia)), []);
  return ok;
}

/** Reads the ration card QR shown in the beneficiary app (it holds the ration card number). */
export function QrScanner({ open, onClose, onResult }: { open: boolean; onClose: () => void; onResult: (value: string) => void }) {
  const { t } = useI18n();
  const video = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  const resultRef = useRef(onResult);
  resultRef.current = onResult;

  useEffect(() => {
    if (!open) return;
    setFailed(false);
    let stream: MediaStream | undefined;
    let stopped = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        const v = video.current!;
        v.srcObject = stream;
        await v.play();
        const detector = new window.BarcodeDetector!({ formats: ['qr_code'] });
        while (!stopped) {
          const value = (await detector.detect(v).catch(() => []))[0]?.rawValue?.trim();
          if (value) return resultRef.current(value);
          await new Promise((r) => setTimeout(r, 250));
        }
      } catch {
        setFailed(true);
      }
    })();
    return () => {
      stopped = true;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [open]);

  return (
    <Modal open={open} onClose={onClose} title={t('scan.title')}>
      {failed ? (
        <Alert tone="warn" title={t('scan.denied')} />
      ) : (
        <div className="space-y-3">
          <video ref={video} muted playsInline className="aspect-square w-full rounded-xl bg-black object-cover" />
          <p className="text-sm text-ink-3">{t('scan.hint')}</p>
        </div>
      )}
    </Modal>
  );
}
