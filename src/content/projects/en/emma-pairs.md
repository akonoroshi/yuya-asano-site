---
title: "How pairs of students teach a robot"
subtitle: "Two lenses on conversations in which two students teach Emma together: whose words they share, and whether they agree on how to solve the problem"
summary: "Lexical alignment and solution-path conflict when two students teach Emma together"
order: 2
period: "2021 – 2026"
facts:
  - { label: "Role", value: "Lead researcher" }
  - { label: "Setting", value: "Two students teach Emma together" }
  - { label: "Methods", value: "Dialogue analysis, annotation, regression modeling" }
  - { label: "Where", value: "University of Pittsburgh" }
links:
  - { label: "Read the AIED 2025 paper", href: "https://doi.org/10.1007/978-3-031-98465-5_16" }
  - { label: "dialign_python on GitHub", href: "https://github.com/akonoroshi/dialign_python" }
replays:
  lexical:
    title: "Who said “two thirds” first?"
    foot: "From a real session (Asano et al., AIED 2025). Some turns omitted. Green italic: Emma initiates the expression. Blue: students reuse it. Bold blue: every speaker has now used it, so it is established."
    turns:
      - role: learner2
        who: "Student B"
        to: "Emma"
        text: "Okay. So Emma, first, you’re going to take the battery usage, which is one over twenty and divide that by the time, which is two over three. So you’re gonna do one over twenty divided by two over three."
      - role: agent
        who: "Emma"
        to: "Student A"
        text: "I get it. So we’re trying to figure out what times two thirds of an hour will give us one hour. But then I’m not sure what to do."
        highlight: [{ text: "two thirds", kind: "initiated" }]
        note: "Student B said “two over three,” but Emma says “two thirds.” This is the first use of the expression, so Emma initiates it."
      - role: learner2
        who: "Student B"
        to: "Student A"
        text: "So then should we just tell her to multiply the battery usage by two thirds?"
        highlight: [{ text: "two thirds", kind: "reused" }]
        note: "Student B adopts Emma’s wording while talking to the partner, not to Emma."
      - role: learner
        who: "Student A"
        to: "Student B"
        text: "Let’s try."
      - role: learner
        who: "Student A"
        to: "Emma"
        text: "It’s not all you’re gonna do, for this one is you’re gonna multiply the battery usage in step zero by two thirds to get what it is in step one."
        highlight: [{ text: "two thirds", kind: "established" }]
        note: "Now all three speakers have used it, so the expression is established. Analyzing each pair of speakers separately would miss that it started with Emma and traveled through the group."
      - role: learner2
        who: "Student B"
        to: "Emma"
        text: "So on the battery usage side, you’re gonna multiply one over twenty times two thirds to get the new value."
        highlight: [{ text: "two thirds", kind: "reused" }]
  resolved:
    title: "A resolved solution-path conflict"
    foot: "From a real session. Some turns omitted. The students planned to halve 1/20 and then triple it; Emma proposed scaling by the ratio of 2/3 of an hour to 1 hour."
    turns:
      - role: learner2
        who: "Student B"
        text: "Yeah. Emma, you should divide one twentieth in half to get one fortieth and then multiply that times three to get a full hour. Since one twentieth is two thirds of an hour."
      - role: agent
        who: "Emma"
        text: "We will multiply. Can you clarify though, what we should multiply?"
      - role: learner2
        who: "Student B"
        text: "You should divide one twentieth by in half to get. You could equal to one third."
      - role: agent
        who: "Emma"
        text: "So we can set up the ratio and I multiply two over three by three over two, right?"
        note: "Emma has mapped the students’ explanation onto a different, also valid, solution. This is a solution-path conflict."
      - role: learner
        who: "Student A"
        text: "So, she did two over three. I don’t know why. Two over three by three over two that would be six over six, which is one. So one hour, so right?"
        note: "Instead of ignoring Emma, the students work out why her approach makes sense."
      - role: learner2
        who: "Student B"
        text: "I think so."
      - role: learner
        who: "Student A"
        text: "So could you use that same right ratio and ..."
      - role: learner2
        who: "Student B"
        text: "Multiply one twentieth by three over two? Like, if you multiply. Yeah."
      - role: learner2
        who: "Student B"
        text: "You should multiply one twentieth times three over two to get the one hour."
        note: "Resolved: the students explicitly switch to Emma’s solution."
      - role: agent
        who: "Emma"
        text: "We know one over twenty times three over two is three over forty?"
  unresolved:
    title: "An unresolved solution-path conflict"
    foot: "From a real session. Some turns omitted. The students wanted the battery usage for 1/3 of an hour, then converted to decimals; Emma stayed with the ratio of 2/3 of an hour to 1 hour."
    turns:
      - role: learner2
        who: "Student B"
        text: "Try finding just the battery usage of one third of an hour and you would usually do that just by dividing by two."
      - role: agent
        who: "Emma"
        text: "I think I understand what you’re saying. So we have two over three because we have two thirds of an hour for one twentieth of the battery. Student A. Do we multiply it by something?"
        note: "Emma has committed to a different solution and assumes the students are following it."
      - role: learner
        who: "Student A"
        text: "No, let’s try another way."
      - role: agent
        who: "Emma"
        text: "Okay. Student A. Can you explain what you mean?"
      - role: learner
        who: "Student A"
        text: "Emma, one divided by twenty is zero point zero five, two divided by three is zero point six six, divide zero point zero five by zero point six six."
      - role: agent
        who: "Emma"
        text: "I think I get it. We’re trying to figure out what times two thirds of an hour will give us one hour. But then I’m not sure what to do."
        note: "This Emma was scripted to keep her solution, so she cannot follow the students’ approach."
      - role: learner
        who: "Student A"
        text: "Yeah, so I guess based on her response to that, she doesn’t quite understand like the decimal conversion. So like I mentioned, just try solving it step by step and as simple as possible."
      - role: learner2
        who: "Student B"
        text: "Emma try dividing by battery usage by time in step zero."
      - role: agent
        who: "Emma"
        text: "Okay. Student A, why do we do that though?"
      - role: learner
        who: "Student A"
        text: "So that you can find the ratio and apply that to step one and step two."
      - role: agent
        who: "Emma"
        text: "Okay. So then for one hour, do we use three fortieths of the battery?"
        note: "Unresolved: the students never take up Emma’s solution, even though both reach the same answer."
---

These studies analyzed conversations in which **two students taught Emma together**: U.S. undergraduates teaching a NAO robot middle-school ratio problems by voice. This Emma used pre-scripted, pattern-matched dialogue. The research is separate from the [LLM version of Emma](/projects/emma-agent/), which one student teaches at a time, though its findings shaped that design.

I study these conversations through two lenses. **Lexical alignment** asks whose words the group ends up sharing. **Semantic (mis)alignment** asks whether the students and Emma agree on how to solve the problem.

Every example below comes from the same problem: Emma uses 1/20 of her battery in 2/3 of an hour. How much does she use in 1 hour?

## Lens 1: Lexical alignment

People in conversation start using each other’s words. Between humans, this tends to signal rapport. With a teachable robot, it’s more complicated: earlier work found that rapport was higher when the robot aligned to students, but lower when students aligned to the robot. So it matters **who aligns to whom**, and with three speakers, existing measures either look only at adjacent turns or blur individuals together.

I extended a measure of shared expressions to multi-party conversation. An expression is **initiated** the first time anyone says it and **established** once every speaker has used it, however many turns later. This credits each speaker with their part in the group’s shared vocabulary.

<div data-example="lexical"></div>

<ul class="findings">
  <li>The new measure predicts rapport better than existing multi-party and pairwise measures, and it separates Emma’s alignment from the students’. When more expressions were established by Emma, rapport with both Emma and the human partner was higher; when more were initiated by Emma, it was lower. Released as the open-source package <a class="inline" href="https://github.com/akonoroshi/dialign_python">dialign_python</a>.<span class="src">AIED 2025</span></li>
  <li>Students mirror a teachable robot’s wording more when teaching it alone than in pairs, and the link between that mirroring and rapport is more complex than human-human theory predicts.<span class="src">SIGDIAL 2022</span></li>
</ul>

## Lens 2: Semantic (mis)alignment

Many math problems have more than one correct solution, so students and an AI partner can disagree even when both are right. I call this a **solution-path conflict**. In these sessions, conflicts happened when Emma misread which solution the students were teaching and then stuck to her own. I annotated each problem as having no conflict, a resolved conflict (the students explicitly reconciled their approach with Emma’s), or an unresolved one.

<div data-example="resolved"></div>

<div data-example="unresolved"></div>

<ul class="findings">
  <li>Unresolved conflicts, not conflict in general, were associated with lower rapport with both Emma and the human partner. Resolved conflicts were not.</li>
  <li>Resolving a conflict did not by itself mean students learned more. What likely matters is whether they actually worked through the competing ideas.</li>
  <li>Part of the link between students’ lexical alignment and rapport is explained by unresolved conflict. When students repeat Emma’s words, they may be working to correct her, not signaling affiliation.</li>
</ul>

These findings motivated the [LLM version of Emma](/projects/emma-agent/): it introduces a second, verified solution on purpose and then guides the student to compare the two.

## Other findings from these sessions

<ul class="findings">
  <li>Compared metrics of participation balance for predicting group learning, including ones a robot could compute automatically and act on in real time.<span class="src">EDM 2024</span></li>
  <li>When speech recognition errors changed the course of the conversation, those changes were not related to learning gains or rapport.<span class="src">AIED 2023, best poster award</span></li>
</ul>

## How the data is built

I design and run lab and classroom studies end to end: experimental design and power analysis, IRB protocols, participant sessions, dialogue and audio collection, annotation, and statistical analysis. For solution-path conflicts, I developed the coding scheme, trained a second annotator, and refined the scheme through disagreement review, reaching Cohen’s κ = .72 and Gwet’s AC1 = .83.

## Collaborators

Diane Litman, Erin Walker, Timothy Nokes-Malach, and Adriana Kovashka at the University of Pittsburgh, and Nikki Lobczowski at McGill University.
