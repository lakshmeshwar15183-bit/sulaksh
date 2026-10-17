import re

blocks = {
"english": """
<h2>Study Guide — English Honours (DU)</h2>
<p>English Honours at Delhi University is a <strong>close-reading and form-aware</strong> programme. Examiners do not reward plot summaries; they reward accurate textual reference, a clear thesis in the first three lines, and awareness of form (sonnet vs. dramatic monologue vs. free verse). Treat every text as a small machine: what is said, how it is said, and one exact quote.</p>
<h3>Exam pattern & marking</h3>
<p>Most papers are 90 marks theory + 10 internal (or 75 + 25 depending on college). Expect one passage-based question (quote 1–2 lines), two 15-mark essays, and three 10-mark shorts. A 15-mark answer that opens with a definition, gives three points (concept + example + quote), one limitation, and a concluding “so what?” consistently crosses 11/15.</p>
<h3>High-yield units (from PYQ mapping)</h3>
<ul>
  <li><strong>Chaucer’s General Prologue</strong> — character sketches, social satire, frame narrative.</li>
  <li><strong>Shakespearean drama</strong> — soliloquy, dramatic irony, tragic flaw.</li>
  <li><strong>Romantic poetry</strong> — nature, imagination, the sublime (Wordsworth, Keats, Shelley).</li>
  <li><strong>Post-colonial theory</strong> — hybridity, mimicry, subaltern (Bhabha, Spivak, Said).</li>
  <li><strong>Indian Writing in English</strong> — diaspora, identity, nation (Rushdie, Roy, Desai).</li>
</ul>
<h3>Common mistakes that cost marks</h3>
<ul>
  <li>Writing a plot summary instead of analysis.</li>
  <li>Quoting from memory without checking the exact line.</li>
  <li>Ignoring form — calling a sonnet “a poem” loses 2–3 marks.</li>
  <li>Not linking the text to its historical/cultural context.</li>
</ul>
<h3>30-day plan</h3>
<ol>
  <li>Days 1–5: Read the primary text; make a one-page sheet per text (what’s said / how it’s said / one quote).</li>
  <li>Days 6–10: Solve 2 past papers per semester under timed conditions.</li>
  <li>Days 11–15: Map every PYQ question to its Unit; note which Units repeat.</li>
  <li>Days 16–20: Write 15-mark answers using the 4-part template; get feedback.</li>
  <li>Days 21–25: Revise one-page sheets; memorise key quotes with line numbers.</li>
  <li>Days 26–30: Full mock papers; fix time management.</li>
</ol>
<p><em>Verify final paper codes and unit lists from your college handout — this guide follows the broad UGCF/NEP outline.</em></p>
""",
"history": """
<h2>Study Guide — History Honours (DU)</h2>
<p>History at DU is <strong>chronology + source discussion + historiography</strong>. Examiners reward answers that name a period bracket, cite one primary source, and end with a concluding historiographical note — not generic narratives.</p>
<h3>Exam pattern & marking</h3>
<p>Typically 75 marks written + 25 internal. Expect one map-based question (locate and explain 4 sites), two 15-mark essays, and three 10-mark shorts. Answers without source discussion rarely cross 6/10.</p>
<h3>High-yield units (from PYQ mapping)</h3>
<ul>
  <li><strong>Ancient India</strong> — sources (epigraphy vs. literary), Mauryan state, Gupta economy.</li>
  <li><strong>Medieval India</strong> — Sultanate administration, Mughal Mansabdari-Jagirdari, Rajput alliances.</li>
  <li><strong>Modern India</strong> — 1857, Bhakti movement, nationalism, Partition.</li>
  <li><strong>World history</strong> — historiography, colonialism, decolonisation.</li>
  <li><strong>Map work</strong> — 4 sites with one-line explanation each.</li>
</ul>
<h3>Common mistakes that cost marks</h3>
<ul>
  <li>Writing without a clear period bracket.</li>
  <li>No primary source (inscription, traveller account, or edict).</li>
  <li>Over-quoting without chronology.</li>
  <li>Ignoring the map question (free 10 marks).</li>
</ul>
<h3>30-day plan</h3>
<ol>
  <li>Days 1–5: Build a timeline per Unit (Ancient → Medieval → Modern).</li>
  <li>Days 6–10: Make a map sheet — 4 sites per Unit with one-line notes.</li>
  <li>Days 11–15: Run the 3-pass PYQ method (mark units → timed answers → one-page sheet).</li>
  <li>Days 16–20: Write 15-mark essays with source + chronology + conclusion.</li>
  <li>Days 21–25: Revise historiography names (Thapar, Chandra, Singh).</li>
  <li>Days 26–30: Full mock papers under timed conditions.</li>
</ol>
<p><em>Verify final unit details from your college handout.</em></p>
""",
"economics": """
<h2>Study Guide — Economics Honours (DU)</h2>
<p>Economics Honours is <strong>mathematical and diagram-driven</strong>. Examiners check formula, substitution, units, and labelled diagrams. One correct AD-AS or indifference-curve diagram often rescues 8/10.</p>
<h3>Exam pattern & marking</h3>
<p>Typically 75 marks theory + 25 internal (or 90 + 10). About 40% weight is numericals. Short answers are 10 marks, longs are 15. Steps carry half the marks.</p>
<h3>High-yield units (from PYQ mapping)</h3>
<ul>
  <li><strong>Introductory Statistics</strong> — descriptive stats, probability, distributions.</li>
  <li><strong>Microeconomics</strong> — consumer equilibrium, elasticity, market structures.</li>
  <li><strong>Macroeconomics</strong> — national income, IS-LM, AD-AS, Phillips curve.</li>
  <li><strong>Mathematical Methods</strong> — matrices, calculus, optimisation.</li>
  <li><strong>Econometrics</strong> — OLS, hypothesis testing, regression.</li>
</ul>
<h3>Common mistakes that cost marks</h3>
<ul>
  <li>Skipping steps in numericals.</li>
  <li>Wrong units or missing labels on diagrams.</li>
  <li>Confusing nominal vs. real values.</li>
  <li>Not showing the formula before substitution.</li>
</ul>
<h3>30-day plan</h3>
<ol>
  <li>Days 1–5: Build a formula sheet per Unit (stats, micro, macro, econometrics).</li>
  <li>Days 6–10: Make a diagram sheet (IS-LM, AD-AS, indifference curves).</li>
  <li>Days 11–15: Solve 10 numericals per Unit under timed conditions.</li>
  <li>Days 16–20: Write 15-mark theory answers with diagrams.</li>
  <li>Days 21–25: Revise high-weight Units (2–3) using PYQ mapping.</li>
  <li>Days 26–30: Full mock papers; check time management.</li>
</ol>
<p><em>Verify final unit details from your college handout.</em></p>
""",
"political-science": """
<h2>Study Guide — Political Science Honours (DU)</h2>
<p>Political Science blends <strong>theory, Indian politics, and comparative/global politics</strong>. Examiners reward a clear thesis in the first three lines, a real-world example (Indian case or Supreme Court judgment), and a concluding “so what?”</p>
<h3>Exam pattern & marking</h3>
<p>4-credit DSC papers (3 lecture + 1 tutorial) across 8 semesters. Most papers are 75 + 25 or 90 + 10. Shorts are 10 marks, longs are 15. Examiners look for concept + critique + Indian example.</p>
<h3>High-yield units (from PYQ mapping)</h3>
<ul>
  <li><strong>Political theory</strong> — liberty, equality, justice, Rawls/Nozick.</li>
  <li><strong>Indian constitution</strong> — federalism, rights, institutions, amendments.</li>
  <li><strong>Comparative politics</strong> — political systems, parties, elections.</li>
  <li><strong>Global politics</strong> — international relations, globalisation, security.</li>
  <li><strong>Public policy</strong> — policy cycles, implementation, evaluation.</li>
</ul>
<h3>Common mistakes that cost marks</h3>
<ul>
  <li>No Indian example or case study.</li>
  <li>Describing concepts without critique.</li>
  <li>Poor structure — no thesis in the opening lines.</li>
  <li>Confusing theory with current affairs.</li>
</ul>
<h3>30-day plan</h3>
<ol>
  <li>Days 1–5: Build a debate table per Unit (concept / critique / Indian example).</li>
  <li>Days 6–10: Map PYQs to Units; note which Units repeat.</li>
  <li>Days 11–15: Write 15-mark answers with thesis + 3 points + conclusion.</li>
  <li>Days 16–20: Revise thinker quotes (Rawls, Ambedkar, Marx).</li>
  <li>Days 21–25: Practice short answers (10 marks, 200 words).</li>
  <li>Days 26–30: Full mock papers under timed conditions.</li>
</ol>
<p><em>Verify final paper codes from your college handout.</em></p>
""",
"mathematics": """
<h2>Study Guide — Mathematics Honours (DU)</h2>
<p>Mathematics Honours is <strong>proof- and problem-driven</strong>. Examiners reward clean logical steps, correct notation, and complete proofs. A correct final answer without working fetches 0.</p>
<h3>Exam pattern & marking</h3>
<p>Sem 1 DSCs: Algebra, Elementary Real Analysis, Probability & Statistics (each 4 credits). Later semesters build through Linear Algebra, Calculus, Group Theory, Riemann Integration, Multivariate Calculus, and ODEs. Most papers are 75 + 25 or 90 + 10.</p>
<h3>High-yield units (from PYQ mapping)</h3>
<ul>
  <li><strong>Algebra</strong> — groups, rings, fields, homomorphisms.</li>
  <li><strong>Real Analysis</strong> — limits, continuity, differentiability, Riemann integration.</li>
  <li><strong>Linear Algebra</strong> — vector spaces, matrices, eigenvalues.</li>
  <li><strong>Probability & Statistics</strong> — distributions, expectation, sampling.</li>
  <li><strong>Calculus</strong> — multivariate, partial derivatives, Lagrange.</li>
</ul>
<h3>Common mistakes that cost marks</h3>
<ul>
  <li>Skipping steps in proofs.</li>
  <li>Wrong notation or missing quantifiers.</li>
  <li>Not stating the theorem being used.</li>
  <li>Arithmetic errors in numericals.</li>
</ul>
<h3>30-day plan</h3>
<ol>
  <li>Days 1–5: Make a theorem-proof sheet per Unit (statement + proof outline).</li>
  <li>Days 6–10: Solve 5 problems per Unit under timed conditions.</li>
  <li>Days 11–15: Revise definitions and counter-examples.</li>
  <li>Days 16–20: Write full proofs; get feedback on notation.</li>
  <li>Days 21–25: Practice high-weight Units (2–3) using PYQ mapping.</li>
  <li>Days 26–30: Full mock papers; fix time management.</li>
</ol>
<p><em>Verify final paper codes from your college handout.</em></p>
""",
"hindi": """
<h2>Study Guide — Hindi Honours (DU)</h2>
<p>Hindi Honours balances <strong>kavya, katha, natak, and bhasha-vigyan</strong> across 8 semesters. Examiners reward accurate textual reference, understanding of form (chhayavaad, pragativad, nayi kavita), and clean Hindi expression.</p>
<h3>Exam pattern & marking</h3>
<p>Sem 1 DSCs: Hindi Kavita (Aadikal & Nirgun Bhaktikavya), Hindi Sahitya ka Itihas (Aadikal & Madhyakal), Hindi Kahani (each 4 credits). Papers are typically 75 + 25 or 90 + 10, with 10-mark shorts and 15-mark longs.</p>
<h3>High-yield units (from PYQ mapping)</h3>
<ul>
  <li><strong>Kavita</strong> — Aadikal, Bhakti, Riti, Adhunik, Chhayavaad.</li>
  <li><strong>Kahani</strong> — Premchand, Agyeya, Mohan Rakesh, contemporary.</li>
  <li><strong>Natak</strong> — Bharatendu, Jayshankar Prasad, Mohan Rakesh.</li>
  <li><strong>Sahitya ka Itihas</strong> — Aadikal to Aadhunik periods.</li>
  <li><strong>Bhasha Vigyan</strong> — vyakaran, rachna, anuvad.</li>
</ul>
<h3>Common mistakes that cost marks</h3>
<ul>
  <li>Memorising without understanding the text.</li>
  <li>Weak examples from the prescribed texts.</li>
  <li>Poor Hindi expression (grammar, gender, tense).</li>
  <li>Ignoring the bhasha-vigyan section.</li>
</ul>
<h3>30-day plan</h3>
<ol>
  <li>Days 1–5: Read prescribed texts; make a one-page sheet per text (theme / form / key lines).</li>
  <li>Days 6–10: Solve 2 past papers per semester under timed conditions.</li>
  <li>Days 11–15: Map PYQs to texts; note repeating questions.</li>
  <li>Days 16–20: Write 15-mark answers with quote + analysis + conclusion.</li>
  <li>Days 21–25: Revise bhasha-vigyan rules and examples.</li>
  <li>Days 26–30: Full mock papers; fix time management.</li>
</ol>
<p><em>Verify final paper codes from your college handout.</em></p>
""",
"sanskrit": """
<h2>Study Guide — Sanskrit Honours (DU)</h2>
<p>Sanskrit Honours moves from <strong>kavya and prose to grammar, poetics, and Indian knowledge systems</strong>. Examiners reward accurate translation, grammatical analysis, and understanding of literary theory (alamkara, rasa, dhvani).</p>
<h3>Exam pattern & marking</h3>
<p>8-semester programme under UGCF 2022. Early semesters cover Classical Sanskrit Literature (Kavya), Critical Survey of Sanskrit Literature, and Vyakarana (grammar). Later semesters add poetics, philosophy, and Indian knowledge systems. Papers are typically 75 + 25 or 90 + 10.</p>
<h3>High-yield units (from PYQ mapping)</h3>
<ul>
  <li><strong>Kavya</strong> — Meghadutam, Abhijnanashakuntalam, Niti literature.</li>
  <li><strong>Vyakarana</strong> — sandhi, samasa, karka, lakara.</li>
  <li><strong>Alamkara / Rasa</strong> — figures of speech, rasa theory, dhvani.</li>
  <li><strong>Darshana</strong> — Nyaya, Vaisheshika, Samkhya, Vedanta basics.</li>
  <li><strong>Sanskrit composition</strong> — translation, essay, letter.</li>
</ul>
<h3>Common mistakes that cost marks</h3>
<ul>
  <li>Ignoring grammar (vyakarana) questions.</li>
  <li>Weak translation without sandhi/samasa analysis.</li>
  <li>Not linking kavya to alamkara theory.</li>
  <li>Memorising without understanding rasa/dhvani.</li>
</ul>
<h3>30-day plan</h3>
<ol>
  <li>Days 1–5: Build grammar tables (sandhi, samasa, karka, lakara).</li>
  <li>Days 6–10: Read prescribed kavya; note key shlokas with meaning.</li>
  <li>Days 11–15: Map PYQs to texts and grammar topics.</li>
  <li>Days 16–20: Write translation + grammatical analysis answers.</li>
  <li>Days 21–25: Revise alamkara and rasa theory with examples.</li>
  <li>Days 26–30: Full mock papers; fix time management.</li>
</ol>
<p><em>Verify final paper codes from your college handout.</em></p>
""",
"geography": """
<h2>Study Guide — Geography Honours (DU)</h2>
<p>Geography Honours is <strong>field- and map-driven</strong>. Examiners reward labelled diagrams, map work, and case studies with data. A well-labelled geomorphology or climate diagram often earns 8/10.</p>
<h3>Exam pattern & marking</h3>
<p>8-semester programme under UGCF 2022. Early semesters cover Physical Geography (Geomorphology, Climatology, Oceanography, Biogeography) and Human Geography. Later semesters add Indian Geography, Regional Planning, and Geospatial Techniques. Papers are typically 75 + 25 or 90 + 10.</p>
<h3>High-yield units (from PYQ mapping)</h3>
<ul>
  <li><strong>Geomorphology</strong> — landforms, plate tectonics, cycle of erosion.</li>
  <li><strong>Climatology</strong> — atmosphere, Koppen classification, monsoon.</li>
  <li><strong>Human Geography</strong> — population, settlement, urbanisation.</li>
  <li><strong>Indian Geography</strong> — physiography, climate, resources, agriculture.</li>
  <li><strong>Geospatial Techniques</strong> — GIS, remote sensing, cartography.</li>
</ul>
<h3>Common mistakes that cost marks</h3>
<ul>
  <li>No maps or diagrams.</li>
  <li>Vague answers without data or case studies.</li>
  <li>Confusing physical and human geography concepts.</li>
  <li>Ignoring the map question (free marks).</li>
</ul>
<h3>30-day plan</h3>
<ol>
  <li>Days 1–5: Build a map sheet — 4 sites per Unit with one-line notes.</li>
  <li>Days 6–10: Make a diagram sheet (landforms, climate graphs, population pyramids).</li>
  <li>Days 11–15: Solve PYQs under timed conditions; note repeating Units.</li>
  <li>Days 16–20: Write 15-mark answers with map + data + conclusion.</li>
  <li>Days 21–25: Revise Indian Geography facts (rivers, soils, crops).</li>
  <li>Days 26–30: Full mock papers; fix time management.</li>
</ol>
<p><em>Verify final paper codes from your college handout.</em></p>
""",
"philosophy": """
<h2>Study Guide — Philosophy Honours (DU)</h2>
<p>Philosophy Honours trains you to <strong>argue, not memorise</strong>. Examiners reward clear argument structure, accurate use of technical terms, and the ability to compare positions (Plato vs. Aristotle, Kant vs. Hume, Advaita vs. Dvaita).</p>
<h3>Exam pattern & marking</h3>
<p>8-semester programme under UGCF 2022. Early semesters cover Indian and Western philosophy (Nyaya, Vaisheshika, Samkhya, Plato, Aristotle, Descartes, Hume). Later semesters add logic, ethics, epistemology, and contemporary philosophy. Papers are typically 75 + 25 or 90 + 10.</p>
<h3>High-yield units (from PYQ mapping)</h3>
<ul>
  <li><strong>Indian philosophy</strong> — Nyaya, Vaisheshika, Samkhya, Yoga, Vedanta, Buddhism, Jainism.</li>
  <li><strong>Western philosophy</strong> — Plato, Aristotle, Descartes, Hume, Kant.</li>
  <li><strong>Logic</strong> — propositional logic, syllogism, fallacies.</li>
  <li><strong>Ethics</strong> — virtue ethics, deontology, utilitarianism.</li>
  <li><strong>Epistemology</strong> — perception, inference, testimony.</li>
</ul>
<h3>Common mistakes that cost marks</h3>
<ul>
  <li>Describing a philosopher without their argument.</li>
  <li>Confusing Indian and Western positions.</li>
  <li>No examples or thought experiments.</li>
  <li>Poor structure — no thesis or conclusion.</li>
</ul>
<h3>30-day plan</h3>
<ol>
  <li>Days 1–5: Build concept maps per philosopher (position / argument / critique).</li>
  <li>Days 6–10: Revise logic (truth tables, syllogisms, fallacies).</li>
  <li>Days 11–15: Map PYQs to topics; note repeating questions.</li>
  <li>Days 16–20: Write 15-mark answers with thesis + argument + counter + conclusion.</li>
  <li>Days 21–25: Practice comparison questions (X vs. Y).</li>
  <li>Days 26–30: Full mock papers; fix time management.</li>
</ol>
<p><em>Verify final paper codes from your college handout.</em></p>
""",
"b-com-hons": """
<h2>Study Guide — B.Com (Hons) (DU)</h2>
<p>B.Com (Hons) is <strong>accounting, law, and finance</strong> driven. Examiners reward correct journal entries, working notes, and provision-based answers. A correct working note fetches 8/12 even if the final figure is off.</p>
<h3>Exam pattern & marking</h3>
<p>8-semester programme under UGCF 2022. Sem 1: Business Organisation, Financial Accounting, Business Laws. Sem 2–4: Corporate Accounting, Cost Accounting, Business Statistics, Financial Management. Sem 5–6: Auditing, GST, Financial Markets. Sem 8: electives. Papers are typically 75 + 25 or 90 + 10.</p>
<h3>High-yield units (from PYQ mapping)</h3>
<ul>
  <li><strong>Financial Accounting</strong> — journal, ledger, trial balance, final accounts.</li>
  <li><strong>Corporate Accounting</strong> — share issue, debentures, amalgamation.</li>
  <li><strong>Cost Accounting</strong> — marginal costing, absorption costing, variance analysis.</li>
  <li><strong>Business Laws</strong> — Contract Act, Sale of Goods, Companies Act.</li>
  <li><strong>GST & Auditing</strong> — input credit, audit procedures, vouching.</li>
</ul>
<h3>Common mistakes that cost marks</h3>
<ul>
  <li>Wrong journal entries (debit/credit swapped).</li>
  <li>Missing working notes.</li>
  <li>Not showing steps in numericals.</li>
  <li>Confusing provisions with sections in law answers.</li>
</ul>
<h3>30-day plan</h3>
<ol>
  <li>Days 1–5: Make a working-notes sheet per Unit (accounting entries, formulas).</li>
  <li>Days 6–10: Solve 5 numericals per Unit under timed conditions.</li>
  <li>Days 11–15: Revise law provisions (Contract Act, Companies Act, GST).</li>
  <li>Days 16–20: Write 15-mark theory answers (definition + provision + example).</li>
  <li>Days 21–25: Practice high-weight Units (accounting, GST) using PYQ mapping.</li>
  <li>Days 26–30: Full mock papers; fix time management.</li>
</ol>
<p><em>Verify final paper codes from your college handout.</em></p>
""",
}

# map subject -> hub file
subject_files = {
 "english": "pyq/english-pyqs.html",
 "history": "pyq/history-pyqs.html",
 "economics": "pyq/economics-pyqs.html",
 "political-science": "pyq/political-science-pyqs.html",
 "mathematics": "pyq/mathematics-pyqs.html",
 "hindi": "pyq/hindi-pyqs.html",
 "sanskrit": "pyq/sanskrit-pyqs.html",
 "geography": "pyq/geography-pyqs.html",
 "philosophy": "pyq/philosophy-pyqs.html",
 "b-com-hons": "pyq/b-com-hons-honours-pyqs.html",
}

for subj, path in subject_files.items():
    block = blocks[subj]
    s = open(path, encoding="utf-8").read()
    marker = "<h2>About This Collection"
    if marker not in s:
        # try alternate
        marker = "<h2>About "
    assert marker in s, f"marker not found in {path}"
    if "Study Guide —" in s:
        print(f"skip (already enriched): {path}")
        continue
    s = s.replace(marker, block + "\n" + marker, 1)
    open(path, "w", encoding="utf-8").write(s)
    print(f"enriched: {path}")
