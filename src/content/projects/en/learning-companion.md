---
title: "AI learning companion"
subtitle: "A 3D study partner designed to keep adults studying for professional exams through to test day"
summary: "A 3D study partner designed to keep adults studying for professional exams"
order: 3
period: "2025 – now"
facts:
  - { label: "Role", value: "Sole designer and engineer" }
  - { label: "When", value: "2025 – now" }
  - { label: "Built with", value: "React, Three.js, three-vrm" }
  - { label: "For", value: "Adults preparing for licensing and certification exams" }
links:
  - { label: "Watch the demo", href: "#" } # TODO: demo video
replay:
  title: "Teaching the companion while studying for a networking certification"
  foot: "Illustrative conversation. Labels show the expression the 3D character plays on each line."
  turns:
    - role: agent
      who: "Companion"
      mood: "unsure"
      text: "Before you start: I keep mixing up the network part and the host part of an IP address."
      note: "States a specific confusion up front, so the learner has a concrete target to teach."
    - role: learner
      who: "You"
      text: "The subnet mask says which bits belong to the network. In a /24, the first 24 bits are the network and the last 8 are the host."
    - role: agent
      who: "Companion"
      mood: "thinking"
      text: "So in 192.168.1.37/24, the host part is just the 37?"
      note: "Applies the idea to a new example, which gives the learner a chance to check it."
    - role: learner
      who: "You"
      text: "Exactly."
    - role: agent
      who: "Companion"
      mood: "curious"
      text: "Then a /24 fits 256 hosts, right? Eight bits is 256."
      note: "Makes a plausible mistake on purpose. Catching it is retrieval practice for the learner."
    - role: learner
      who: "You"
      text: "Close, but two addresses are reserved: the network address and the broadcast address. So 254."
    - role: agent
      who: "Companion"
      mood: "happy"
      text: "254. Got it, thank you! I’ll remember the two reserved ones."
---

## The problem: people stop studying

Adults preparing for professional licenses and certifications usually study alone, around full-time work, and many drop off long before the exam. For most of them, the material isn’t the hardest part. Staying with it is.

This project is about **retention**. The companion is a study partner with its own character, who studies the same material alongside the learner and reacts to what they say. The goal is to make studying feel less solitary, so learners keep coming back.

## Teaching the companion, to learn more

Inside each session, the learner teaches the companion. This is a feature for learning, not the reason the companion exists: people tend to learn material more deeply when they explain it to someone else, an effect known as the protégé effect. Drawing on my research on teachable agents, the companion states what confuses it, restates ideas in new examples, and occasionally makes a believable mistake for the learner to catch.

## Building it

The companion is a 3D anime-style character that runs in the browser. Its facial expressions and gestures are driven by the dialogue, so it reacts to what the learner says rather than looping idle animations.

<ul class="stack" aria-label="Technologies">
  <li>React</li>
  <li>Three.js</li>
  <li>@pixiv/three-vrm (VRM 1.0)</li>
  <li>LLM dialogue</li>
  <li>Inverse kinematics</li>
</ul>

## Gestures that never pass through the body

Expressive gestures create a hard problem: a hand raised to the chin or crossed over the chest can clip through the character’s own body, which instantly breaks the illusion. I built an inverse-kinematics layer that adjusts each gesture in real time to avoid self-collision, with strict guarantees rather than best-effort fixes, while keeping the animation smooth enough for a browser on an ordinary laptop.

<div class="media">Side-by-side clip goes here: the same gesture with and without collision avoidance.</div>
