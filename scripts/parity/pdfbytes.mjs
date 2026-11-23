// Parse page count and MediaBox from raw PDF bytes — no PDF library.
// SPEC-001 explicitly forbids adding a PDF-parsing dependency; if this parse
// ever proves unreliable against Chrome output, the run must FAIL loudly
// (cross-checking against the print-emulated rect is the sanctioned
// fallback, decided by tech-lead, not a silent relaxation).

/**
 * @param {Buffer} buffer raw PDF bytes
 * @returns {{pageCount: number, mediaBoxes: Array<{x:number,y:number,width:number,height:number}>}}
 */
export function parsePdfSummary(buffer) {
  // PDF string bodies are ASCII; latin1 keeps byte<->char 1:1.
  const text = buffer.toString("latin1");

  // Page objects: "/Type /Page" (must not match "/Pages").
  const pageMatches = text.match(/\/Type\s*\/Page(?![sA-Za-z])/g);
  const pageCount = pageMatches ? pageMatches.length : 0;

  const mediaBoxes = [];
  const mediaBoxRe =
    /\/MediaBox\s*\[\s*(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s*\]/g;
  let m;
  while ((m = mediaBoxRe.exec(text)) !== null) {
    mediaBoxes.push({
      x: Number(m[1]),
      y: Number(m[2]),
      width: Number(m[3]),
      height: Number(m[4]),
    });
  }

  if (pageCount === 0 && mediaBoxes.length === 0) {
    throw new Error(
      "PDF PARSE FAILURE: no /Type /Page or /MediaBox found in raw PDF bytes " +
        `(${buffer.length} bytes). Byte parsing is unreliable against this ` +
        "Chrome output — this is a hard stopper, not a pass.",
    );
  }
  if (pageCount === 0) {
    throw new Error(
      "PDF PARSE FAILURE: page count could not be read from raw PDF bytes.",
    );
  }
  if (mediaBoxes.length === 0) {
    throw new Error(
      "PDF PARSE FAILURE: no /MediaBox found in raw PDF bytes.",
    );
  }
  return { pageCount, mediaBoxes };
}
