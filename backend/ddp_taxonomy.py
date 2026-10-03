"""
DDP Taxonomy v0.2 — Data, Digital & Privacy Law classification tree.
Used by the Legal Workbench demo to auto-tag external regulatory sources.
Source of truth: projects/legal-research-platform/taxonomy-design.md (v0.2, open questions resolved 2026-08-27)
"""

# Level 1-3 taxonomy nodes (id -> label). Level 4/5 leaves grow organically per the design;
# classification proposes the deepest stable node available.
TAXONOMY_NODES = {
    # A — Data Protection & Privacy Law
    "A": "Data Protection & Privacy Law",
    "A.1": "GDPR (EU) — regulation & interpretations",
    "A.1.1": "Principles & legal bases",
    "A.1.2": "Data subject rights",
    "A.1.3": "Controller/processor obligations",
    "A.1.4": "International transfers",
    "A.1.5": "Supervisory authorities & enforcement",
    "A.1.6": "Remedies, liability & penalties",
    "A.1.7": "Specific processing situations",
    "A.1.8": "Delegated & implementing acts",
    "A.2": "National DP laws — EU member states",
    "A.3": "FADP (Switzerland) + cantonal DP laws",
    "A.3.1": "Scope & definitions (incl. cantonal interplay)",
    "A.3.2": "Principles & legal bases",
    "A.3.3": "Data subject rights",
    "A.3.4": "Cross-border transfers (Annex 1 FODP)",
    "A.3.5": "FDPIC powers & enforcement",
    "A.3.6": "Breach notification (Art. 24)",
    "A.3.7": "DPIA & DPO provisions",
    "A.3.8": "Cantonal DP laws (reserved placeholder)",
    "A.4": "ePrivacy & electronic communications",
    "A.5": "International data transfers",
    "A.6": "Data subject rights & enforcement",
    "A.7": "Sectoral privacy",
    "A.7.1": "Health & life sciences (clinical trials, RWD, pharmacovigilance)",
    "A.7.2": "Financial services (banking secrecy, PSD2, AML)",
    "A.7.3": "Telecommunications (ePrivacy, universal service)",
    "A.7.4": "Insurance (solvency, policyholder data)",
    "A.7.5": "Employment & HR data",
    "A.8": "International frameworks (Convention 108+, OECD, APEC CBPR)",
    "A.9": "Privacy engineering & technology (PETs, anonymization, DPIA)",
    # B — AI & Digital Regulation
    "B": "AI & Digital Regulation",
    "B.1": "EU AI Act",
    "B.1.1": "Scope & definitions",
    "B.1.2": "Prohibited practices",
    "B.1.3": "High-risk AI systems",
    "B.1.4": "Transparency obligations (incl. GPAI)",
    "B.1.5": "Governance & supervisory authorities",
    "B.1.6": "Standards & conformity assessment",
    "B.1.7": "Penalties & enforcement timeline",
    "B.1.8": "SME & innovation measures",
    "B.2": "Digital Services Act (DSA)",
    "B.3": "Digital Markets Act (DMA)",
    "B.4": "Data Act & Data Governance Act",
    "B.5": "NIS2 & Cyber Resilience Act",
    "B.6": "AI liability & product safety",
    "B.7": "Standards & harmonized norms (ISO/IEC 42001, CEN/CENELEC)",
    "B.8": "Platform regulation & online content",
    "B.9": "eIDAS & trust services",
    "B.10": "Digital consumer protection",
    # C — Information Governance
    "C": "Information Governance",
    "C.1": "Records management & retention",
    "C.2": "Classification & safeguarding",
    "C.3": "eDiscovery & legal hold",
    "C.4": "Archives & long-term preservation",
    "C.5": "Data quality & lifecycle",
    # Z — catch-all
    "Z": "Unclassified / Misc",
}

# Cross-cutting topic tags (controlled vocabulary)
TAXONOMY_TAGS = [
    "biometrics", "children", "employee-monitoring", "health-data",
    "automated-decision-making", "profiling", "data-breach", "DPIA",
    "processor", "controller", "data-transfer", "SCC", "BCR", "adequacy",
    "copyright", "trade-secrets", "open-data", "data-sharing", "web-scraping",
    "foundation-models", "GPAI", "chatbots", "biometric-identification",
    "remote-biometric", "cookie-consent", "direct-marketing", "whistleblowing",
    "internal-investigation", "pharma-research", "clinical-trials", "RWD",
    "pharmacovigilance", "cybersecurity", "incident-response",
]

# Orthogonal axes
INSTRUMENT_TYPES = [
    "REGULATION", "DIRECTIVE", "DECISION", "JUDGMENT", "DPA_DECISION",
    "OPINION", "GUIDELINES", "POLICY", "SOP", "STANDARD",
    "CONTRACT_CLAUSE", "COMMENTARY",
]

JURISDICTIONS = [
    "EU", "CH", "DE", "FR", "IT", "AT", "ES", "NL", "BE", "UK", "US", "INTL",
]

TEMPORAL_STATUSES = ["IN_FORCE", "REPEALED", "SUPERSEDED", "DRAFT", "PROPOSED"]


def taxonomy_labels(ids):
    """Resolve dotted IDs to {id: label}; unknown IDs map to themselves."""
    return {i: TAXONOMY_NODES.get(i, i) for i in ids}
