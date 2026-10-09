import { isTouchFirst } from '../settings/Settings';

export type ShareMethod = 'share' | 'download';

/**
 * How the card leaves the game. Touch-first devices with Web Share file support get the native share
 * sheet; everything else (desktop browsers, including Chrome on Windows which also has Web Share)
 * downloads the PNG, which is what a desktop player expects from a button on a score screen.
 */
export function shareMethod(): ShareMethod {
  try {
    if (!isTouchFirst() || typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return 'download';
    const probe = new File([new Uint8Array(1)], 'probe.png', { type: 'image/png' });
    return navigator.canShare({ files: [probe] }) ? 'share' : 'download';
  } catch {
    return 'download';
  }
}

/**
 * Shares or downloads the card. Resolves to the method used, or null when the player closed the share
 * sheet. A failing share (not a cancel) falls back to the download.
 */
export async function deliverCard(blob: Blob, fileName: string, text: string, method: ShareMethod): Promise<ShareMethod | null> {
  if (method === 'share') {
    const file = new File([blob], fileName, { type: 'image/png' });
    try {
      await navigator.share({ files: [file], title: 'Spaghettify', text });
      return 'share';
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return null;
    }
  }
  download(blob, fileName);
  return 'download';
}

function download(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.style.display = 'none';
  document.body.append(a);
  a.click();
  a.remove();
  // Revoke later: some browsers start reading the blob after the click returns.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
