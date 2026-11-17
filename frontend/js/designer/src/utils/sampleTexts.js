// Example texts the customer has not replaced yet.
//
// A template text such as "Voornaam" or "telefoon nr" is the merchant's
// example, waiting for the customer's own words. Nothing stopped a customer
// from ordering with one still in place — and then "Achternaam" is what gets
// engraved.
//
// An example is recognised by a FLAG the designer puts on the object
// (`data.sampleText`, set when a template text or a new "Your text here" is
// created, cleared the moment its text changes) — never by what the text says.
// The words themselves are the merchant's, in whatever language the shop is
// in, so comparing against a list of known example words would work for one
// language and silently miss every other.

const isTextType = (type) => /^(i-?text|text|textbox)$/i.test(String(type || ''));

const isSample = (obj) => obj?.data?.sampleText === true
  && isTextType(obj.type)
  && obj.visible !== false
  && String(obj.text ?? '').trim() !== '';

/** Example texts in one view's saved JSON. */
export function sampleTextsInJson(json) {
  return (json?.objects || []).filter(isSample).map((o) => String(o.text).trim());
}

/**
 * Every unreplaced example across the design.
 *
 * The view being worked on is read from the live canvas (its stored snapshot
 * can lag behind), the others from their snapshots.
 *
 * @returns {Array<{viewIndex:number, text:string}>}
 */
export function collectSampleTexts({ canvas, activeViewIndex, snapshots = {} }) {
  const found = [];
  if (canvas) {
    canvas.getObjects().filter(isSample)
      .forEach((o) => found.push({ viewIndex: activeViewIndex, text: String(o.text).trim() }));
  }
  Object.entries(snapshots).forEach(([key, json]) => {
    const viewIndex = Number(key);
    if (canvas && viewIndex === activeViewIndex) return;
    sampleTextsInJson(json).forEach((text) => found.push({ viewIndex, text }));
  });
  return found.sort((a, b) => a.viewIndex - b.viewIndex);
}

/** The first unreplaced example on the live canvas, to hand to the customer. */
export function firstSampleObject(canvas) {
  return canvas?.getObjects().find(isSample) || null;
}

/**
 * Leave the examples out: empty them. An empty text is never engraved or
 * exported (shared/js/textPlaceholder.js keeps it as a dashed box the
 * customer can still fill in later), which also works for a text the merchant
 * pinned in place and that therefore cannot be deleted.
 *
 * @returns the snapshot JSON with its examples emptied (for views that are
 *          not on the canvas right now)
 */
export function emptySamplesInJson(json) {
  if (!json?.objects) return json;
  return {
    ...json,
    objects: json.objects.map((o) => (isSample(o)
      ? { ...o, text: '', data: { ...o.data, sampleText: false } }
      : o)),
  };
}

export function emptySamplesOnCanvas(canvas) {
  if (!canvas) return 0;
  const samples = canvas.getObjects().filter(isSample);
  samples.forEach((o) => {
    if (o.isEditing) o.exitEditing();
    o.set({ text: '', data: { ...o.data, sampleText: false } });
    o.initDimensions?.();
    o.setCoords();
    canvas.fire('text:changed', { target: o });
  });
  if (samples.length > 0) {
    canvas.discardActiveObject();
    canvas.requestRenderAll();
  }
  return samples.length;
}
