import { h } from './escape';
import { A4, PHOTO_PT, PrintColors as C, PrintTier, EXTRA_PHOTO_PT } from './report-tokens';
import type { ReportModel, ReportSymptom, RichText } from './summary-report';

/**
 * The Screening Summary Report's print template.
 *
 * Deliberately free of runtime imports beyond two constant-only modules, mirroring the
 * `tps-core.ts` convention, so `scripts/test-report-html.mjs` can render and assert on it in
 * node without a simulator. Everything the page needs — styles, images, fonts — is inline:
 * the print WebView must never reach the network, because the page holds patient PII and a
 * lesion photograph. `assertNoRemoteRefs` enforces that rather than trusting it.
 *
 * Typography is a system grotesque stack rather than the app's Hanken Grotesk: the display
 * face ships as an npm package with no local TTFs, and base64-embedding it would add ~250 KB
 * to both the bundle and every PDF for a document whose brand signal is already carried by
 * the wordmark. Brand identity lives in the in-app preview, which does use Hanken.
 */

/** Base64 image data URIs supplied by report-assets.ts. */
export type ReportAssets = {
  /** "data:image/png;base64,…" — the SpotOn wordmark for the header. */
  wordmark: string | null;
  /** "data:image/jpeg;base64,…" — the lesion photo, or null when unavailable. */
  photo: string | null;
  /**
   * Additional views of the SAME lesion, in capture order, excluding the primary. Absent or empty
   * for a single-photo screening, in which case the printed layout is byte-for-byte unchanged.
   */
  extraPhotos?: string[];
};

const EM_DASH = '—';

export function buildReportHtml(model: ReportModel, assets: ReportAssets): string {
  const tier = PrintTier[model.tier];
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<title>Screening Summary Report</title>
<!-- No viewport meta: the layout is sized in points against the A4 print box that
     Print.printToFileAsync sets up. A CSS-pixel viewport would rescale it. -->
<style>${styles(tier)}</style></head>
<body>
  <div class="hdr">
    <div class="hdrLeft">
      ${assets.wordmark ? `<img class="mark" src="${assets.wordmark}" alt="SpotOn">` : `<div class="markText">SpotOn</div>`}
      <h1>Screening Summary Report</h1>
    </div>
    <div class="stamp">Date: ${h(model.dateLabel)}<br>Time: ${h(model.timeLabel)}</div>
  </div>
  <div class="rule"></div>

  <div class="sec">Profile</div>
  <table class="profile">
    <tr>
      <td class="k">Name</td><td class="v">${value(model.patient.name)}</td>
      <td class="k">Date of Birth</td><td class="v">${value(model.patient.dobLine)}</td>
    </tr>
    <tr>
      <td class="k">Sex</td><td class="v">${value(model.patient.sex)}</td>
      <td class="k">Contact</td><td class="v">${value(model.patient.contact)}</td>
    </tr>
  </table>

  <div class="sec">Lesion Image and Classification Result</div>
  <div class="lesion">
    ${
      assets.photo
        ? `<img class="photo" src="${assets.photo}" alt="Lesion photograph">`
        : `<div class="photo photoMissing"><span>Lesion photo<br>unavailable</span></div>`
    }
    <div class="cls">
      <div class="clsLabel">Classification Result</div>
      <div class="clsName">${h(model.classificationFull)} (${h(model.classificationCode)})</div>
      <div class="clsConf">Model Confidence: <b>${h(model.confidenceLabel)}</b></div>
    </div>
  </div>
${extraViews(assets.extraPhotos)}
  <div class="sec">Reported Symptoms (Patient Self-Report)</div>
  <table class="sym">
    <thead><tr><th class="q">Symptom / Sign</th><th class="a">Response</th></tr></thead>
    <tbody>${model.symptoms.map(symptomRow).join('')}</tbody>
  </table>

  <div class="sec">Urgency Level and Recommendation</div>
  <div class="urg">
    <div class="urgBox"><span class="urgWord">${h(model.urgencyLabel)}</span></div>
    <div class="urgText">
      <p>${rich(model.urgencyLead)}</p>
      <p>${h(model.recommendation)} The user is strongly advised to <b>${h(lowerFirst(model.priorityAction))}</b>.</p>
      ${qualifierNote(model)}
    </div>
  </div>

  <div class="alert"><b>IMPORTANT:</b> ${h(model.printDisclaimer)}</div>
</body></html>`;
  assertNoRemoteRefs(html);
  return html;
}

/**
 * Why the urgency reads the way it does, when it was not the classifier's own verdict.
 *
 * Both flags were computed, persisted and put on the report model, and neither had a single render
 * site — so a screening whose photo could not be read printed as a clean clinical document
 * ("MODERATE urgency… the system detected a low-confidence Melanoma classification") with no
 * statement that the image was unreadable. The in-app result screen has always shown this; the PDF
 * a clinician actually reads did not. Same wording as the app, so the two surfaces agree.
 *
 * The wording itself lives on the model (`summary-report.ts` `assessmentNote`) rather than being
 * imported here: this template stays free of runtime imports so the node test can render it.
 */
function qualifierNote(model: ReportModel): string {
  if (!model.assessmentNote) return '';
  return `<p class="caveat"><b>Note on this assessment:</b> ${h(model.assessmentNote)}</p>`;
}

/**
 * Offline guarantee, enforced rather than assumed. Any absolute or protocol-relative
 * reference would make the print WebView hit the network while rendering a page full of
 * patient PII. Throws so it can never ship silently.
 *
 * `data:` URIs are stripped before scanning — base64 uses `/` freely, so their payloads
 * would otherwise trip the protocol-relative pattern.
 */
export function assertNoRemoteRefs(html: string): void {
  const withoutDataUris = html.replace(/data:[a-z/+.-]+;base64,[A-Za-z0-9+/=]+/g, 'data:inline');
  const match = withoutDataUris.match(/(?:https?:)?\/\/[^\s"')]+/);
  if (match) {
    throw new Error(`[report] remote reference in offline report HTML: ${match[0]}`);
  }
}

function value(v: string | null): string {
  return v ? h(v) : EM_DASH;
}

/** "See a dermatologist as soon as possible" -> "see a dermatologist as soon as possible". */
function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

function rich(runs: RichText): string {
  return runs.map((r) => (r.bold ? `<b>${h(r.text)}</b>` : h(r.text))).join('');
}

/**
 * The additional-views strip. Renders nothing at all when the screening has one photo, so the
 * approved single-photo layout is untouched for the overwhelming majority of reports.
 *
 * These are documentation, not evidence the model used: the classifier reads the primary photo
 * only (model-config MULTI_IMAGE_AGGREGATION_ENABLED ships false), and the caption says so. A
 * clinician reading this needs to know which pixels produced the number above it.
 */
function extraViews(photos: string[] | undefined): string {
  if (!photos?.length) return '';
  return `
  <div class="views">
    <div class="viewsLabel">Additional views of the same lesion (not used for classification)</div>
    <div class="viewsRow">
      ${photos
        .map((p, i) => `<img class="viewThumb" src="${p}" alt="Additional lesion view ${i + 2}">`)
        .join('')}
    </div>
  </div>`;
}

function symptomRow(s: ReportSymptom): string {
  const rowClass = s.answer === 'No' ? ' class="rNo"' : '';
  return (
    `<tr${rowClass}><td class="q">${h(s.question)}</td>` +
    `<td class="a a${s.answer}">${h(s.answer)}</td></tr>`
  );
}

function styles(tier: { fg: string; bg: string; border: string }): string {
  return `
  @page { size: A4; margin: 0; }
  html, body { margin: 0; padding: 0; }
  * { box-sizing: border-box; }
  body {
    padding: ${A4.margin}pt;
    font-family: -apple-system, "Helvetica Neue", Helvetica, Roboto, "Segoe UI", Arial, sans-serif;
    font-size: 9.5pt;
    line-height: 1.35;
    color: ${C.body};
    /* Without this the WebView drops the navy header row and the cream table fills. */
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  /* 1 — header */
  .hdr { display: flex; align-items: flex-end; justify-content: space-between; }
  .mark { height: 15pt; width: auto; display: block; margin-bottom: 5pt; }
  .markText { font-size: 11pt; font-weight: 700; color: #F26A2E; letter-spacing: -.2pt; margin-bottom: 4pt; }
  .hdr h1 { font-size: 21pt; font-weight: 700; color: ${C.ink}; margin: 0; letter-spacing: -.3pt; }
  .stamp { text-align: right; font-size: 8.5pt; color: ${C.labelMuted}; line-height: 1.55; }
  /* Sunset lead-in on the rule — the one brand accent in the document body. */
  .rule {
    height: 1.5pt; margin: 7pt 0 4pt;
    background: linear-gradient(90deg, #FF8A4C 0, #FFB98E 78pt, ${C.hairline} 78pt, ${C.hairline} 100%);
  }

  /* section labels */
  .sec {
    font-size: 7.5pt; font-weight: 700; letter-spacing: .6pt; text-transform: uppercase;
    color: ${C.labelMuted}; margin: 8pt 0 3pt;
  }

  /* 2 — profile grid */
  table.profile { width: 100%; border-collapse: collapse; }
  table.profile td { padding: 4pt 0; border-bottom: .5pt solid ${C.hairlineSoft}; vertical-align: top; }
  table.profile tr:last-child td { border-bottom: 0; }
  td.k { width: 78pt; font-size: 8pt; font-weight: 700; color: ${C.labelMuted}; }
  td.v { font-size: 9.5pt; color: ${C.body}; padding-left: 8pt; padding-right: 12pt; }

  /* 3 — lesion + classification */
  .lesion { display: flex; gap: 22pt; align-items: flex-start; margin-top: 2pt; }
  .photo {
    width: ${PHOTO_PT}pt; height: ${PHOTO_PT}pt; flex: 0 0 ${PHOTO_PT}pt;
    object-fit: cover; display: block;
    background: ${C.photoPlaceholderBg}; border: .5pt solid ${C.hairlineSoft};
  }
  .photoMissing {
    display: flex; align-items: center; justify-content: center; text-align: center;
    border: 1pt dashed ${C.hairline}; color: ${C.answerNo}; font-size: 9pt; line-height: 1.5;
  }
  /* Optically centres the block against the photo, as on the approved layout — flex
     centring sits noticeably lower than the reference. */
  .cls { flex: 1; padding-top: 48pt; text-align: center; }
  .clsLabel { font-size: 11pt; font-weight: 700; color: ${C.ink}; }
  .clsName { font-size: 19pt; font-weight: 700; color: ${C.ink}; margin: 5pt 0 4pt; letter-spacing: -.2pt; }
  .clsConf { font-size: 11pt; color: ${C.body}; }
  .clsConf b { font-weight: 700; }

  /* 3b — additional views (only present on multi-photo screenings) */
  .views { margin-top: 10pt; page-break-inside: avoid; }
  .viewsLabel { font-size: 8pt; font-weight: 700; color: ${C.labelMuted}; margin-bottom: 5pt; }
  .viewsRow { display: flex; gap: 8pt; }
  .viewThumb {
    width: ${EXTRA_PHOTO_PT}pt; height: ${EXTRA_PHOTO_PT}pt; flex: 0 0 ${EXTRA_PHOTO_PT}pt;
    object-fit: cover; display: block;
    background: ${C.photoPlaceholderBg}; border: .5pt solid ${C.hairlineSoft};
  }

  /* 4 — symptom table */
  table.sym { width: 100%; border-collapse: collapse; table-layout: fixed; }
  table.sym thead { display: table-header-group; }
  table.sym tr { page-break-inside: avoid; }
  table.sym th {
    background: ${C.ink}; color: #fff; font-size: 8.5pt; font-weight: 700;
    text-align: left; padding: 5pt 7pt;
  }
  /* Wider than the reference's 79/21: the questionnaire wording here is a little longer
     than the figure's, and the extra width is what keeps every row to a single line. */
  th.q { width: 85%; }
  th.a { width: 15%; text-align: center; }
  table.sym td {
    background: ${C.rowCream}; border: .5pt solid ${C.rowCreamBorder};
    padding: 4.5pt 7pt; font-size: 8.5pt;
  }
  td.a { text-align: center; font-weight: 700; }
  /* Yes / No / Unsure differ by weight and style as well as hue, so the table survives a
     grayscale photocopy. */
  .aYes { color: ${C.answerYes}; }
  .aNo { color: ${C.answerNo}; font-weight: 400; }
  .aUnsure { color: ${C.answerUnsure}; font-style: italic; }
  tr.rNo td.q { color: ${C.mutedRow}; }

  /* 5 — urgency */
  .urg { display: flex; gap: 14pt; align-items: stretch; margin-top: 2pt; }
  .urgBox {
    width: 167pt; flex: 0 0 167pt; min-height: 76pt;
    display: flex; align-items: center; justify-content: center;
    border: .75pt solid ${tier.border}; background: ${tier.bg};
  }
  .urgWord { font-size: 20pt; font-weight: 700; color: ${tier.fg}; letter-spacing: .4pt; }
  .urgText { flex: 1; font-size: 9pt; text-align: justify; }
  .urgText p { margin: 0 0 5pt; }
  .urgText p:last-child { margin-bottom: 0; }
  .urgText b { font-weight: 700; }

  .caveat { margin-top: 6pt; padding-left: 8pt; border-left: 2pt solid ${tier.border}; }

  /* 6 — disclaimer */
  .alert {
    margin-top: 11pt; border: .75pt solid ${C.alertBorder}; background: ${C.alertBg};
    padding: 7pt 9pt; font-size: 8pt; color: ${C.answerYes}; text-align: justify; line-height: 1.4;
  }
  .alert b { font-weight: 700; }
  `;
}
