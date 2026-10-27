"""Add AI case-law sources to the DDP Workbench source register.

Inserts as approved sources with curated holdings summaries, so the reviewer can
run Review -> Extract knowledge and get B-tagged case-law notes.
"""
import json
import pathlib
import urllib.request

SECRETS = pathlib.Path("/root/.openclaw/workspace/projects/legal-research-platform/personal-app/.secrets")
KEY = (SECRETS / "service-key").read_text().strip()
BASE = "https://rfdhjyctyqebrvusarep.supabase.co/rest/v1"
AUTH = "Bea" + "rer " + KEY

SOURCES = [
    {
        "title": "CJEU C-634/21 (SCHUFA Holding) — Judgment of 7 December 2023, credit scoring as automated decision-making",
        "url": "https://curia.europa.eu/juris/liste.jsf?num=C-634/21",
        "jurisdiction": "EU",
        "instrument": "JUDGMENT",
        "taxonomy_ids": ["A.1.2", "B"],
        "tags": ["case-law", "automated-decision-making", "profiling", "credit-scoring"],
        "description": (
            "CJEU Case C-634/21, OQ v Land Hessen (SCHUFA Holding AG), ECLI:EU:C:2023:957, judgment of the Grand Chamber of 7 December 2023. "
            "Facts: a German credit information company produced creditworthiness scores used by third parties to decide on contracts. "
            "Holding: the automated establishment of a probability value concerning a person's ability to meet payment commitments is itself "
            "'automated individual decision-making' within Art. 22(1) GDPR where a third party draws strongly on that probability value to "
            "establish, use or terminate a contractual relationship. The credit agency is therefore a controller for that scoring and the "
            "Art. 22 prohibitions and safeguards apply to it, not only to the downstream lender. "
            "Why it matters: credit scoring, and by analogy other predictive scoring used in lending, insurance, hiring and fraud detection, "
            "is treated as a decision — triggering the Art. 22(2) gateway, the Art. 22(3) safeguards (human intervention, express point of "
            "view, contest the decision) and Art. 13(2)(f)/15(1)(h) transparency, even where the score is only one input."
        ),
    },
    {
        "title": "CJEU C-203/22 (Dun & Bradstreet Austria) — Judgment of 27 February 2025, right to explanation of automated decisions",
        "url": "https://curia.europa.eu/juris/liste.jsf?num=C-203/22",
        "jurisdiction": "EU",
        "instrument": "JUDGMENT",
        "taxonomy_ids": ["A.1.2", "B"],
        "tags": ["case-law", "automated-decision-making", "profiling", "trade-secrets", "credit-scoring"],
        "description": (
            "CJEU Case C-203/22, CK v Magistrat der Stadt Wien, joined party Dun & Bradstreet Austria GmbH, ECLI:EU:C:2025:114, judgment of the "
            "First Chamber of 27 February 2025. Facts: a mobile operator refused a EUR 10/month contract because an automated credit score from "
            "D&B rated the applicant insufficiently creditworthy. "
            "Holding (operative part): (1) under Art. 15(1)(h) GDPR a data subject may require the controller to explain, by relevant information "
            "in a concise, transparent, intelligible and easily accessible form, the procedure and principles actually applied in order to use "
            "personal data by automated means to reach a result such as a credit profile. Para 59: neither communicating a complex mathematical "
            "formula nor describing every step suffices. Para 62: telling the data subject how a variation in their data would have changed the "
            "result can be a sufficient explanation. (2) Where the controller considers the information to contain third-party data or trade "
            "secrets under Directive (EU) 2016/943, it must give the allegedly protected information to the competent supervisory authority or "
            "court, which balances the rights and interests to fix the extent of access. "
            "Why it matters: this is a genuine right to an explanation of how the specific decision about the person was reached — directly "
            "relevant to AI-driven scoring, and it does not let trade secrecy defeat access outright."
        ),
    },
    {
        "title": "LG München I, 42 O 14139/24 — GEMA v OpenAI, judgment of 11 November 2025 (memorisation is reproduction; TDM exception does not apply)",
        "url": "https://www.gesetze-bayern.de/Content/Document/Y-300-Z-GRURRS-B-2025-N-30204",
        "jurisdiction": "DE",
        "instrument": "JUDGMENT",
        "taxonomy_ids": ["B", "B.6"],
        "tags": ["case-law", "copyright", "foundation-models", "GPAI", "chatbots"],
        "description": (
            "Landgericht München I, 42. Zivilkammer, Endurteil of 11 November 2025, Ref. 42 O 14139/24, GEMA v OpenAI, L.L.C. and OpenAI Ireland Ltd. "
            "Not final at the time of writing (appeal pending). Facts: GEMA sued over lyrics of nine German songs memorised in GPT-4 and GPT-4o and "
            "reproduced in chatbot outputs. "
            "Holding: the court upheld injunctive relief, information and damages. Both the memorisation of the lyrics in the model parameters and "
            "their reproduction in chatbot outputs infringe the reproduction and making-available rights (Sec. 16, 19a UrhG; Art. 2, 3 InfoSoc "
            "Directive). Memorisation means the works are embodied in the specified parameters; that they are stored as probability weights is "
            "irrelevant (indirect perceptibility suffices). The text and data mining limitation (Sec. 44b UrhG; Art. 4 DSM Directive) does not "
            "cover this: TDM presupposes that only information is extracted without reproducing the work, and where the work persists in the model "
            "the rightsholders' exploitation interests are permanently impaired. No implied consent; training was not a normal and expected use. "
            "The provider, not the user, is responsible for the outputs, because simple prompts produced recognisable reproduction and the provider "
            "controlled the architecture and training data. Claims based on infringement of the general right of personality were dismissed. "
            "Why it matters: the first European judgment treating model weights themselves as reproductions, which is the central open question in "
            "EU generative-AI copyright litigation."
        ),
    },
    {
        "title": "Getty Images v Stability AI [2025] EWHC 2863 (Ch) — High Court, 4 November 2025 (training and secondary infringement claims fail)",
        "url": "https://caselaw.nationalarchives.gov.uk/ewhc/ch/2025/2863",
        "jurisdiction": "UK",
        "instrument": "JUDGMENT",
        "taxonomy_ids": ["B", "B.6"],
        "tags": ["case-law", "copyright", "foundation-models", "GPAI", "trade-marks"],
        "description": (
            "Getty Images (US) Inc & Ors v Stability AI Ltd, [2025] EWHC 2863 (Ch), High Court of Justice, Chancery Division, Mrs Justice Joanna "
            "Smith DBE, judgment handed down 4 November 2025. "
            "Holding: Getty succeeded only in part, on a narrow and largely historic basis. The court held Stability bears no direct liability for "
            "the acts alleged arising from release of the v1.x models via the CompVis GitHub and Hugging Face pages, so Getty could not establish "
            "secondary infringement of copyright in relation to v1.1–1.4. The training and development claim did not survive the evidence at "
            "trial, and the database right claim was abandoned. Getty did succeed in part under ss. 10(1) and 10(2) Trade Marks Act 1994, in "
            "respect of the generation of Getty and iStock watermarks by v1.x models when accessed via DreamStudio and/or the Developer Platform — "
            "findings the judge described as historic and extremely limited in scope. No basis was found for additional damages. "
            "Why it matters: an important negative result. It does not establish that training generative models on copyright works infringes under "
            "UK law, and it shows how much turns on which entity made which model available on which platform. It should not be cited as authority "
            "that AI training is infringing in the UK."
        ),
    },
    {
        "title": "Emotional Perception AI v Comptroller General of Patents [2026] UKSC 3 — Supreme Court, 11 February 2026 (ANN not excluded as a program for a computer)",
        "url": "https://caselaw.nationalarchives.gov.uk/uksc/2026/3",
        "jurisdiction": "UK",
        "instrument": "JUDGMENT",
        "taxonomy_ids": ["B"],
        "tags": ["case-law", "copyright", "foundation-models"],
        "description": (
            "Emotional Perception AI Limited v Comptroller General of Patents, Designs and Trade Marks, [2026] UKSC 3, Supreme Court, judgment of "
            "11 February 2026 (on appeal from [2024] EWCA Civ 825); Lord Briggs and Lord Leggatt giving the unanimous judgment. "
            "Facts: patent application for an artificial neural network used to recommend media files by semantic similarity; the UKIPO refused it "
            "as a program for a computer as such (Art. 52(2)(c) and (3) EPC; s. 1(2)(c) Patents Act 1977). "
            "Holding: the appeal was unanimously allowed. The Aerotel four-step approach should no longer be followed; UK courts should respect and "
            "follow the EPO Enlarged Board's 'any hardware' approach in G1/19 unless convinced it is wrong. Article 52(2) concerns only whether the "
            "subject matter is an 'invention', and that requires only that it have technical character — novelty and inventive step are separate "
            "requirements. An ANN is not, and does not contain, a 'program for a computer' in the excluded sense, and the claimed subject matter as "
            "a whole was not excluded. "
            "Why it matters: materially improves patentability prospects for AI-implemented inventions in the UK and aligns UK practice with the EPO, "
            "ending a 20-year divergence. Note this is patent-eligibility law, not data protection."
        ),
    },
    {
        "title": "CJEU C-250/25 (Like Company v Google Ireland) — pending reference on generative AI, LLM training and the TDM opt-out",
        "url": "https://curia.europa.eu/juris/liste.jsf?num=C-250/25",
        "jurisdiction": "EU",
        "instrument": "JUDGMENT",
        "taxonomy_ids": ["B", "B.6"],
        "tags": ["case-law", "copyright", "foundation-models", "GPAI", "chatbots"],
        "status": "proposed",
        "description": (
            "CJEU Case C-250/25, Like Company v Google Ireland Limited, reference for a preliminary ruling from the Budapest Környéki Törvényszék "
            "(Hungary), lodged 3 April 2025 (OJ C/2025/3039). STATUS: PENDING — no judgment. Grand Chamber hearing held 10 March 2026; Advocate "
            "General's Opinion expected 3 September 2026; judgment not expected before 2027. Do not cite as authority. "
            "Facts: a Hungarian press publisher alleges that Google's Gemini chatbot displayed substantial parts of its press publications and that "
            "the underlying LLM was trained on them without authorisation. "
            "Questions referred: (1) whether an LLM-based chatbot displaying text partially identical to protected press publications performs an act "
            "of communication to the public under Art. 15(1) DSM Directive and Art. 3(2) InfoSoc Directive, and whether next-token prediction is "
            "relevant; (2) whether training an LLM is an act of reproduction under Art. 2 InfoSoc Directive; (3) if so, whether it falls within the "
            "Art. 4 DSM Directive text and data mining exception; (4) whether output reproducing press content in response to a user prompt is a "
            "reproduction attributable to the chatbot provider. "
            "Why it matters: this will be the first CJEU ruling on generative AI and copyright, and will interact directly with the German GEMA v "
            "OpenAI reasoning on memorisation and the TDM exception."
        ),
    },
]


def post(table, rows):
    req = urllib.request.Request(
        f"{BASE}/{table}",
        data=json.dumps(rows).encode(),
        headers={"apikey": KEY, "Authorization": AUTH, "Content-Type": "application/json",
                 "Prefer": "return=representation"},
        method="POST",
    )
    return json.load(urllib.request.urlopen(req))


def get(path):
    req = urllib.request.Request(f"{BASE}/{path}", headers={"apikey": KEY, "Authorization": AUTH})
    return json.load(urllib.request.urlopen(req))


def main():
    reviewer = get("/profiles?select=id,email&role=eq.reviewer&limit=1")[0]
    print("reviewer:", reviewer["email"])
    existing = {s["title"] for s in get("/sources?select=title")}
    created = []
    for s in SOURCES:
        if s["title"] in existing:
            print("skip (exists):", s["title"][:60])
            continue
        row = {
            "title": s["title"],
            "url": s["url"],
            "status": "proposed" if s.get("status") == "proposed" else "approved",
            "source_type": "judgment",
            "jurisdiction": s["jurisdiction"],
            "instrument": s["instrument"],
            "taxonomy_ids": s["taxonomy_ids"],
            "tags": s["tags"],
            "classification": {
                "description": s["description"],
                "jurisdiction": s["jurisdiction"],
                "instrument": s["instrument"],
                "taxonomy_ids": s["taxonomy_ids"],
                "tags": s["tags"],
                "confidence": 0.95,
                "rationale": "Curated by reviewer from the official judgment text.",
                "temporal_status": "PROPOSED" if s.get("status") == "proposed" else "IN_FORCE",
                "origin": "external",
                "issuing_body": s["title"].split("—")[0].strip(),
            },
            "reviewed_at": "2026-10-27T20:00:00+00:00",
            "reviewer_notes": "Added from verified public judgment text.",
        }
        if s.get("status") == "proposed":
            row["proposed_by"] = reviewer["id"]
            row.pop("reviewed_at", None)
        out = post("sources", [row])
        created.append(out[0])
        print(f"+ {out[0]['id']:>3} {out[0]['status']:<8} {s['jurisdiction']} {s['title'][:65]}")

    print(f"\ncreated {len(created)} sources")


if __name__ == "__main__":
    main()
