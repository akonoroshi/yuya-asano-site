---
title: "Emma, an LLM teachable agent"
subtitle: "An LLM agent that a student teaches math to, which offers a second, verified solution and asks the student to compare the two"
summary: "An LLM agent that introduces a second solution and helps one student compare the two"
order: 1
period: "2026 – now"
facts:
  - { label: "Role", value: "Designer and engineer of the agent harness" }
  - { label: "Setting", value: "One student teaches Emma" }
  - { label: "Study", value: "Controlled study, 72 participants, IRB-approved" }
  - { label: "Built with", value: "Python, Azure OpenAI, vLLM, ASP.NET, Azure SQL" }
links:
  - { label: "The studies that motivated it", href: "/projects/emma-pairs/" }
replay:
  title: "One student teaches Emma"
  foot: "Illustrative conversation. Problem: 3 cups of flour make 2 cakes. How much flour for 5 cakes?"
  turns:
    - role: learner
      who: "Student"
      text: "First you figure out the flour for one cake."
    - role: agent
      who: "Emma"
      text: "Do you mean dividing the 3 cups by the 2 cakes?"
      note: "The explanation could fit more than one verified solution, so Emma asks a clarifying question instead of guessing."
    - role: learner
      who: "Student"
      text: "Yes. Find how much one cake needs, then scale up to five."
    - role: agent
      who: "Emma"
      text: "Got it. I thought of another way: multiply 3 by 5 first, then divide by 2. Which way should we use?"
      note: "Once the student’s solution is clear, Emma introduces a verified alternative and lets the student choose."
    - role: learner
      who: "Student"
      text: "Let’s do mine."
    - role: agent
      who: "Emma"
      text: "Okay, your way. What’s the first step?"
      note: "Emma now goes through the steps. During this first step, the classifier keeps running in the background, so Emma can still switch to a better-matching solution without slowing the conversation."
    - role: learner
      who: "Student"
      text: "Divide 3 by 2 to get 1.5 cups, because that’s the flour for one cake. Then multiply by 5, since we need five cakes."
      note: "This answer gives the what, how, and why of step 1, and also of step 2. Emma records both."
    - role: agent
      who: "Emma"
      text: "So should we multiply 1.5 by 5 next?"
      note: "Step 2 is already fully explained, so Emma only asks a yes/no question instead of asking for each piece again."
    - role: learner
      who: "Student"
      text: "Yes. That’s 7.5 cups."
    - role: agent
      who: "Emma"
      text: "7.5 cups! Your way found one cake first, and mine multiplied first. What if 3 cups made 7 cakes, and we wanted 14 cakes? Which way would be easier?"
      note: "With every step done, Emma reflects back both solutions and asks which works better on a twist that breaks the simplicity of one of them."
    - role: learner
      who: "Student"
      text: "Yours, because 3 divided by 7 isn’t a nice number."
---

## Why plan a disagreement

Teaching someone else is one of the most reliable ways to learn, and a teachable agent lets every student be the teacher. Comparing different solutions to the same problem can deepen that learning, but disagreement can also backfire: in our [studies of student pairs](/projects/emma-pairs/), disagreements left unresolved predicted lower rapport. So this version of Emma doesn’t leave disagreement to chance. Once she understands the student’s solution, she offers a verified alternative, and after the problem is solved, she asks the student to compare the two.

## How the conversation flows

I’m designing and building the LLM agent harness behind Emma, in Python. It runs on Azure OpenAI (Azure AI Foundry) for the study, and I serve open-weight models locally on vLLM for prototyping and offline experiments.

<ol class="pipeline" aria-label="How a conversation with Emma flows">
  <li>The student starts explaining their solution</li>
  <li>Emma matches it to a verified solution, or asks a clarifying question</li>
  <li class="is-key">Emma introduces a verified alternative and asks which approach to follow</li>
  <li>Emma goes through the steps, tracking what, how, and why for each</li>
  <li class="is-key">Emma reflects back both solutions and asks which works better on a slightly different problem</li>
</ol>
<p class="caption">Simplified flow for one problem.</p>

Each LLM call returns one structured JSON object that contains both Emma’s judgment (for example, which solution matched and which parts of a step are covered) and what she says next, so the judgment and the response are generated together.

## What made it hard

Two problems took the most work: knowing which solution the student means, and tracking each step.

**Uncertainty about the student’s solution.** Students’ first explanations are often incomplete, so an early match can be wrong. After Emma commits to one verified solution, I keep running the LLM classifier asynchronously during the first step of that solution, so it adds no latency. If the student’s later explanations fit another verified solution better, Emma switches the match.

**Tracking what, how, and why.** Students often explain several steps at once, or give the reason for a step before reaching it. So the LLM records what, how, and why for future steps too, not just the current one. When a new step already has all three, Emma simply asks a yes/no question, like “Should we do … next?” This significantly reduced unnecessary back-and-forth.

## Running the study

The agent is deployed in an IRB-approved controlled study with 72 participants. I own the study infrastructure end to end: an ASP.NET web application, the Python dialogue service (migrated from rule-based AIML to LLM-based), Azure SQL, and the data pipelines, with participant data kept in an IRB-compliant institutional Azure environment, separate from other research compute.
