# 🚀 HiredeskHR — Next-Gen AI Recruitment SaaS Platform

> **A Bespoke, High-Velocity Applicant Tracking System & Recruiter Platform**  
> Inspired by **[PyjamaHR](https://pyjamahr.com)** with an original, creative, ultra-professional design language and tailored strictly to the recording transcript specifications.

---

## 🌟 Key Capabilities & Transcript Alignment

| Feature from Transcript | Implementation in HiredeskHR |
| :--- | :--- |
| **High-Converting Landing Page** | Built with Electric Indigo & Slate aesthetic. Interactive mini-ATS sandbox in hero, 4 core recruitment pillars, social proof, dynamic "Go to App" button when logged in, and pricing tiers. |
| **Pillar 1: Jobs & 4-Step Creation Wizard** | **Step 1:** Job Title, Client Name (`HiredeskHR`), Department, Location, CTC Range, Experience.<br>**Step 2:** Form customization with mandatory fields (Name, Email, Phone, Location, Resume locked ON) and toggleable optional fields (Current CTC, Expected CTC, Total Experience, Notice Period) + screening questions builder.<br>**Step 3:** 7-stage hiring flow.<br>**Step 4:** 3 Finishing Up buttons: **'Manage Job'** (LinkedIn email injection alert), **'Invite Team'**, and **'Share on Social Media'**. |
| **Pillar 2: Talent Pool** | Unified cross-job candidate database with search by skills, experience, stage, and role. |
| **Pillar 3: Recruiter Email Hub** | Unified inbox for candidate email threads, rich message history, 1-click recruiter templates (Interview Invite, Offer Letter, Rejection), and a live **"Simulate LinkedIn Ingestion"** action button. |
| **Pillar 4: Reports & Analytics** | Executive dashboard displaying: Total Jobs Posted, Active Jobs, Total Candidates, Active Candidates, Interviews Scheduled, Hirings, and a visual 6-stage funnel conversion chart. |
| **Pillar 5: Interview Scheduler & Scorecards** | Calendar & round coordination (pre-seeded with **Neha Sharma** for Senior Software Engineer), Google Meet video link generation, and structured 5-star interviewer scorecards with consensus voting (`STRONG_HIRE`, `HIRE`, `MAYBE`, `NO_HIRE`). |
| **AI Recruiter Interactive Roadmap** | Features the audio/video scenario from the transcript (*"Welcome to your interview with PyjamaHR for the role of Senior Software Engineer. My name is Sukul, and I'm an AI who will be conducting..."*) with an interactive audio player, soundwave visualizer, and candidate debrief preview. |
| **Public Branded Career Portal** | Dedicated public portal (`/careers/software-workforce`) displaying client branding, open jobs, and dynamic application form. Applying here automatically injects the candidate and resume into the client dashboard's **Applied** stage! |
| **LinkedIn Email Ingestion Flow** | Automated flow where posting a job alerts the admin email; LinkedIn applications trigger inbound email alerts with attached resumes auto-synced to that job requisition. |
| **Settings & Extensions** | Subscription Module (usage limits & upgrades), Employer Referral Program (referral codes & rewards), Partner Program (20% revenue share), and Career Page Customizer. |

---

## ⚡ Quick Start & Running Locally

### 1. From the Project Directory (`hiredeskhr`):
```bash
# Start both Backend and Frontend concurrently:
npm run dev
```

- **Frontend App**: `http://localhost:5174` (React + TypeScript + Vite + Tailwind CSS)
- **Backend API**: `http://localhost:5001` (Node.js + Express + TypeScript)
- **Public Career Portal**: Click **"Public Career Page"** in the top header, or navigate to `http://localhost:5174/careers/software-workforce`

### 2. Run the End-to-End Automated Test Suite:
```bash
npm test
```
Executes all 24 automated assertions covering authentication, job posting wizard, public candidate application injection, Kanban stage advancement, interview scorecards, LinkedIn email ingestion, and analytics calculations.

---

## 🔑 1-Click Demo Accounts

| Account | Email | Role | Organization |
| :--- | :--- | :--- | :--- |
| **Sarah Jenkins** | `recruiter@hiredeskhr.com` | Lead Recruiter / Org Admin | HiredeskHR |
| **HiredeskHR Operations** | `admin@talentflow.io` | Super Admin | HiredeskHR Global Ops |

Both accounts can be accessed instantly using the **1-Click Quick Demo Access** buttons inside the Sign In modal without requiring manual password entry.
