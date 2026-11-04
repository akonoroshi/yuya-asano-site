---
title: "Contextual speech recognition correction"
subtitle: "Using what a voice assistant already knows about the task to fix what it misheard"
summary: "Fixing mishearings with dialogue context; 3rd place, Alexa Prize TaskBot"
order: 4
period: "2023"
facts:
  - { label: "Role", value: "First author, method and evaluation" }
  - { label: "Team", value: "ISABEL, Alexa Prize TaskBot Challenge 2" }
  - { label: "Result", value: "Third place" }
  - { label: "Paper", value: "COLING 2025, Industry Track" }
links:
  - { label: "Read the paper", href: "https://aclanthology.org/2025.coling-industry.32/" }
  - { label: "arXiv", href: "https://arxiv.org/abs/2501.06129" }
demo: "asr-correction"
---

## The problem

Our Alexa TaskBot helped people with cooking and home improvement tasks. General-purpose speech recognition often failed on exactly the words that mattered, like task and tool names. In our data, 4.1% of utterances had a recognition error, and 18.2% of conversations had at least one. Existing correction methods depend on prior user data or named entities, which a new assistant in a new domain doesn’t have.

## The approach

The assistant already knows what the user is likely to say next: the options it just offered, the commands available at this step, and the full list of tasks it supports. The method uses that context in two ways, shown in the demo above.

**Re-ranking the guesses.** The recognizer returns up to five guesses. Each one is checked against the context by lexical and semantic similarity, and a lower-ranked guess wins if it is the only one that matches a real task. This handles extra words people insert in the middle of a request.

**Matching by sound.** When none of the guesses is right, the method compares phoneme sequences between the best guess and the context, using their longest common subsequence. This handles words the recognizer garbled and words the user added or left out.

To handle the many ways people phrase the same request, we clustered the task list and used GPT-3.5 to generate variations only for cluster centroids, adding 160K phrasings to the search index at low cost. The method needs no prior user data and adds no LLM latency at run time, because augmentation happens offline. In deployment, the assistant confirmed each correction by asking “Did you mean …?”

## Results

<table class="results">
  <tr><td>.18 → .54</td><td>Correction recall, compared with a named-entity baseline (offline evaluation)</td></tr>
  <tr><td>.27 → .44</td><td>Correction F1, compared with the same baseline</td></tr>
  <tr><td>+.8 to 1</td><td>Higher user ratings (out of 5) with real users when the correction worked, and false positives did not significantly lower ratings</td></tr>
</table>

## Team

Built as part of team ISABEL (IncluSive And collaBorativE aLexa) at the University of Pittsburgh, advised by Malihe Alikhani. Our TaskBot placed third in the Alexa Prize TaskBot Challenge 2.
