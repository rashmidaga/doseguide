# DoseGuide

**Every dose, on time.** A medication-management app for seniors and the people who care for them — reminders, real-time refill tracking, and caregiver oversight in one calm place.

DoseGuide is the working MVP of a product concept defined in a full PRD/MRD: it targets the ~1.2M seniors in Massachusetts who struggle with medication adherence, and the caregivers supporting them. Where basic reminder apps stop at a nudge, DoseGuide adds the two things those users actually need — **refill/inventory tracking** and a **caregiver experience**.

## What it does

**For the person taking medications**
- A daily schedule on a timeline, with a live "Up next" card and countdown
- One-tap *Take / Skip*, with dose history and an animated adherence ring
- Real-time pill-supply tracking that flags a refill before you run out
- A one-touch **emergency call** to a caregiver, right on the home screen
- A personal health profile: conditions, allergies, care team, insurance, emergency contacts

**For the caregiver**
- A live overview of their patient's day and adherence
- A *needs attention* feed for missed doses and low supplies
- Confirm-taken and one-tap reminder nudges
- Full access to the patient's health profile
- An activity feed and quick-message shortcuts

**Shared**
- Phone + OTP sign-in (demo code: `0000`)
- Month calendar with Apple-Watch-style adherence rings on every day
- Add / edit medications with flexible dose times

## Tech

Deliberately dependency-free: hand-written **HTML, CSS, and vanilla JavaScript** — no framework, no build step. Data persists in the browser via `localStorage`, so it runs offline and hosts anywhere static. Type is Fraunces + Inter; all iconography is inline SVG.

```
index.html    — markup + app shell
styles.css    — "Porcelain & Evergreen" visual system
app.js        — dose engine, both role experiences, all views
favicon.svg   — app mark
```

`server.js` / `serve.ps1` are local preview helpers only; they are not needed to host the app.

## Run locally

Any static server works. With Node:

```bash
node server.js 5050
# then open http://localhost:5050
```

Or just open `index.html` in a browser.

## Roadmap (from the PRD)

Native push notifications, live caregiver sync across devices, and direct CVS/Walgreens refill ordering are the next milestones. This MVP proves the core loop.

---

*Built as a product + prototype exercise. Not a medical device; does not provide medical advice.*
