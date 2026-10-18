// Shared display-title cleanup for material rows.
//
// Source titles come from bulk-uploaded scans/OCR: some carry stray glyphs
// (leading "_—:_", quotes, underscores), broken punctuation, or are pure
// garbage. PDFs and file_name values are NEVER touched — this only normalizes
// the human-readable title shown on the site.
//
// Used by both generators so the static snapshot and the server-rendered
// pages always agree:
//   - scripts/generate-materials.mjs (assets/data/materials.json snapshot)
//   - scripts/generate-seo.mjs       (static SEO pages)

export function cleanTitle(raw) {
  let t = String(raw || '').trim();
  if (!t) return t;

  // --- existing normalizations (kept from the original inline version) ---
  // truncated marks: "90 ma" / "30 mark" -> "90 marks"
  t = t.replace(/\b(\d+)\s+marks?\b/gi, (_, n) => `${n} marks`);
  t = t.replace(/\b(\d+)\s+ma\b/gi, '$1 marks');
  t = t.replace(/\b(\d+)\s+mar\b/gi, '$1 marks');
  // category token duplication: "VAC | VAC", "GE - GE", ...
  let prev;
  do {
    prev = t;
    t = t.replace(/\bVAC\s*[|\-]\s*VAC\b/gi, 'VAC');
    t = t.replace(/\bGE\s*[|\-]\s*GE\b/gi, 'GE');
    t = t.replace(/\bSEC\s*[|\-]\s*SEC\b/gi, 'SEC');
    t = t.replace(/\bAEC\s*[|\-]\s*AEC\b/gi, 'AEC');
    t = t.replace(/ - VAC\s*\|\s*VAC/gi, ' - VAC');
    t = t.replace(/ - GE\s*\|\s*GE/gi, ' - GE');
    t = t.replace(/ - SEC\s*\|\s*SEC/gi, ' - SEC');
    t = t.replace(/ - AEC\s*\|\s*AEC/gi, ' - AEC');
  } while (t !== prev);
  t = t.replace(/\bGE\s*\|\s*GE(\s*–)/gi, 'GE$1');
  t = t.replace(/\bVAC\s*\|\s*VAC(\s*–)/gi, 'VAC$1');
  t = t.replace(/\bSEC\s*\|\s*SEC(\s*–)/gi, 'SEC$1');
  t = t.replace(/\bAEC\s*\|\s*AEC(\s*–)/gi, 'AEC$1');
  // generic pipe dedupe: drop consecutive case-insensitive duplicates
  const parts = t.split('|').map((p) => p.trim());
  const deduped = [];
  for (const p of parts) {
    const last = deduped[deduped.length - 1];
    if (last && last.toLowerCase() === p.toLowerCase()) continue;
    if (last && p.toLowerCase().startsWith(last.toLowerCase().split(' ')[0]) && last.toLowerCase().split(' ')[0].length >= 2 && ['vac', 'ge', 'sec', 'aec'].includes(last.toLowerCase().split(' ')[0])) {
      if (p.length > last.length) deduped[deduped.length - 1] = p;
      continue;
    }
    deduped.push(p);
  }
  t = deduped.join(' | ');
  t = t.replace(/\s{2,}/g, ' ').replace(/\s*\|\s*\|\s*/g, ' | ').trim();
  t = t.replace(/vac\s*-\s*vac/gi, 'VAC');
  t = t.replace(/ge\s*-\s*ge/gi, 'GE');

  // --- OCR artifact cleanup (Oct 2026) ---
  // underscore placeholders left by unsupported glyphs
  t = t.replace(/\s*_\s*/g, ' ');
  // leading junk: "_—:_", "»+ ", ". . ", "“: ", "£", "#", "|" ...
  t = t.replace(/^[^\p{L}\p{N}(\[]+/u, '');
  // dash–colon artifacts and a dangling dash after an em dash
  t = t.replace(/\s*([—–])\s*:+/g, ' $1');
  t = t.replace(/\s*:+\s*([—–])/g, ' $1');
  t = t.replace(/([—–])\s*-\s*/g, '$1 ');
  // century quote marks: 18" Century / 14" to 17" Century (must run before quote stripping)
  t = t.replace(/(\d+)"\s+to\s+(\d+)"\s+Century/gi, '$1th to $2th Century');
  t = t.replace(/(\d+)"\s+Century/gi, '$1th Century');
  // stray quote marks next to spaces (keeps apostrophes inside words: Women’s)
  t = t.replace(/(?<=\s)[“”"‘’]\s*/g, '');
  t = t.replace(/\s*[“”"‘’]+(?=\s)/g, '');
  // broken punctuation runs
  t = t.replace(/(?:\s*\.\s*){2,}/g, ' ');
  t = t.replace(/\s*,\s*,+/g, ',');
  t = t.replace(/\s*\\+\s*/g, ' ');
  t = t.replace(/\s+%\s*/g, ' ');
  // "©" used for circa: "From © 300 BCE" -> "From c. 300 BCE"
  t = t.replace(/©\s*(?=\d)/g, 'c. ');
  t = t.replace(/©/g, '');
  // spacing before colon
  t = t.replace(/\s+:/g, ':');
  // repeated calendar year after the PYQ stamp: "…-2024 2024 —" -> "…-2024 —"
  t = t.replace(/(PYQ\s+(?:NOV|MAY)[\s-]+(?:DEC|JUNE)[\s-]+(\d{4}))\s+\2\b/gi, '$1');
  // known OCR word errors
  t = t.replace(/Steochemistry/gi, 'Stereochemistry');
  t = t.replace(/Hounors/gi, 'Honours');
  // collapse whitespace; the underscore strip may expose a new leading symbol
  t = t.replace(/\s{2,}/g, ' ').trim();
  t = t.replace(/^[^\p{L}\p{N}(\[]+/u, '').trim();
  return t;
}

// Manual repairs for titles where the OCR text is unrecoverable by rules
// alone. Paper names were verified against the PDFs themselves (Oct 2026);
// the file names / CDN keys stay untouched.
export const TITLE_OVERRIDES = new Map([
  // English/Hindi literature overrides from the Oct 2026 audit
  ['bb272bd8-609b-4bfa-9d70-7bff911e0cae', 'Women\u2019s Writing PYQ MAY-JUNE-2026 - Sem 6'],
  ['b157a572-ce6b-4d18-9321-70f73f67562a', 'Readings on Indian Diversities and Literary Movements PYQ NOV-DEC-2024 - Sem 1'],
  ['f471a100-5b5e-4b4a-b7e5-e4d84b54386b', 'Post Colonial Literatures PYQ MAY-JUNE-2026 - Sem 6'],
  ['9718bef1-28e3-49d6-ae91-188480ccdaa4', 'Indian Writing in English PYQ MAY-JUNE-2026 - Sem 4'],
  ['4b310707-23bd-4067-b8a2-521fa57d94d4', 'Skills for Dissertation Writing in Sanskrit PYQ MAY-JUNE-2026 - Sem 6'],
  // OCR-garbled English titles (mechanical rules can't rebuild the words)
  ['fd601f6c-4489-402d-8a48-04abdf0d8e68', 'Financial Economics I PYQ MAY-JUNE-2025 - Sem 4'],
  ['d5fad9cc-b731-42e2-965e-79b41001e009', 'Financial Economics PYQ MAY-JUNE-2025 - Sem 4'],
  ['e3ec5c2d-2c50-4ee6-b73c-66a03903dd4f', 'Intermediate Macroeconomic I: Foundations of Aggregate Income Determination PYQ MAY-JUNE-2025 - Sem 4'],
  ['a34b4965-df5f-4990-b5c7-acf62a65b089', 'Evolution of Geographical Thought (Core) PYQ NOV-DEC-2024 - Sem 5'],
  ['c47eadc5-a8ae-4a1d-9f12-b3143e1aea15', 'Developmental Biology of Angiosperms: Form, Anatomy and Function PYQ MAY-JUNE-2026 - Sem 6'],
  ['d86f0ea9-ec8d-474b-8890-4b4a6a5509ba', 'DSC: Principles in Qualitative Analysis & Bioinorganic Chemistry PYQ MAY-JUNE-2025 - Sem 6'],
  ['3b9b6680-0e28-4408-9a85-a983b0046726', 'DSE — Chemistry of d-block Elements, Quantum Chemistry and Spectroscopy PYQ NOV-DEC-2024 - Sem 5'],
  ['6d2e4730-1028-4566-97c2-ed2ddd91fe80', 'DSC 3: Gaseous and Liquid State (Physical Chemistry - I) PYQ NOV-DEC-2024 - Sem 1'],
  ['696cd1a9-966e-47db-9928-5a8177d23002', 'Social Formations and Cultural Patterns of the Ancient World PYQ NOV-DEC-2024 - Sem 1'],
  ['09b931a8-1cf3-45be-a443-3c556969f2e3', 'Social Formations and Cultural Patterns of the Ancient World-I PYQ NOV-DEC-2024 - Sem 1'],
  ['bdf37fd3-f231-41bc-bf06-46d2ad89cadc', 'DSE-13, Reproductive Biology and Assisted Reproductive Techniques PYQ NOV-DEC-2024 - Sem 5'],
  ['ad880661-6cfd-4a3a-b01c-6a90f2f7cc98', 'MARKETING RESEARCH PYQ MAY-JUNE-2026 - Sem 6'],
  ['09058d3d-8e19-43b2-bc7c-fdbcf7391419', 'MARKETING RESEARCH PYQ MAY-JUNE-2026 - Sem 6 - Paper 2'],
  ['f7cb19c7-702c-42ef-b2d8-8b6f12cda002', 'History of India-II (From 300 BCE to 750 CE) PYQ NOV-DEC-2024 - Sem 1'],
  ['035d80f3-f672-4008-a9e6-0c72cf75f899', 'HISTORY OF THE USSR — FROM REVOLUTION TO DISINTEGRATION (C. 1917-1991) PYQ NOV-DEC-2024 - Sem 5'],
  ['acf4c585-faf4-41b2-8b8e-27b314813254', 'CITIZENSHIP AND GOVERNANCE PYQ NOV-DEC-2025 - Sem 7'],
  ['c707f97b-2f87-4b0f-b8fa-b5711fe0ed89', 'DSC — Haloalkanes, Arenes, Haloarenes, Alcohols, Phenols, Ethers and Epoxides PYQ NOV-DEC-2025 - Sem 1'],
  ['4eb5e8bf-ece0-447e-97c1-7200c75b82e9', 'HINDI CINEMA AUR USKA ADHYAYAN PYQ NOV-DEC-2025 - Sem 1'],
  ['7dd6a443-68f9-4674-b415-c1f34a92a08e', 'Aadikal evam Nirgunbhakti Kavya PYQ NOV-DEC-2024 - Sem 1'],
  ['6da9935a-995d-4584-8900-406643c98d17', 'Hindi Evam Anya Bhartiya Bhashayein PYQ NOV-DEC-2025 - Sem 7'],
  ['f00abb5c-5d85-4a74-80c4-df4307087242', 'Social Media Marketing — Notes'],
  // Hindi-medium papers: titles recovered by OCR from the PDFs themselves
  ['fc64ca60-956f-46ac-a603-fe89af1e89a1', 'आषाढ़ का एक दिन PYQ NOV-DEC-2025 - Sem 7'],
  ['471825e0-e851-4286-96cd-b1a696bbe53c', 'अस्मितामूलक हिंदी साहित्य (दलित विमर्श, स्त्री विमर्श एवं आदिवासी विमर्श) PYQ MAY-JUNE-2026 - Sem 6'],
  ['5075dd45-6aa3-4a55-a06b-76404ad85e8b', 'अस्मितामूलक हिंदी साहित्य (दलित विमर्श, स्त्री विमर्श एवं आदिवासी विमर्श) PYQ MAY-JUNE-2025 - Sem 6'],
  ['c38cae7e-1761-41e5-bc55-98bcbcb74a8d', 'अस्मितामूलक विमर्श और हिंदी साहित्य PYQ NOV-DEC-2024 - Sem 5'],
  ['0ba2430b-5774-4996-8f1a-dedf3336b2e2', 'भारतेंदु हरिश्चन्द्र PYQ MAY-JUNE-2026 - Sem 6'],
  ['022839f3-5bab-4c6e-9dc9-282afcae9959', 'आधुनिक हिंदी कविता (छायावादोत्तर) PYQ NOV-DEC-2024 - Sem 5'],
  ['a49cb363-3cb6-4cf8-9375-7220ed9bda52', 'हिंदी सिनेमा: व्यावसायिक संदर्भ PYQ NOV-DEC-2024 - Sem 5'],
  ['f009e09f-dfbe-4ad0-bf63-8082ec5111fb', 'पाश्चात्य काव्यशास्त्र PYQ NOV-DEC-2024 - Sem 5'],
]);
