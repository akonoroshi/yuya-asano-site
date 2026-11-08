"""Prints ARPAbet pronunciations from g2pE, formatted for src/data/chat/terms.ts.

Usage:  pip install g2p_en  &&  python3 scripts/chat/g2p_oov.py SigIQ EverTutor
Check each result by ear: g2pE's neural fallback guesses at names and acronyms.
"""
import sys

from g2p_en import G2p

g2p = G2p()
for word in sys.argv[1:]:
    phones = [p for p in g2p(word) if p.strip() and p[0].isalpha()]
    print(f'  {{ text: "{word}", en: "{" ".join(phones)}" }},')
