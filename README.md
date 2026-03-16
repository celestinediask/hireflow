# HireFlow

![Admin dashboard](screenshots/admin.webp)
![Candidates dark theme](screenshots/candidates-dark-theme.webp)
![Candidates light theme](screenshots/candidates-light-theme.webp)
![Prescreening form](screenshots/form.webp)
![Live interview chat](screenshots/interview.webp)
![Typing test](screenshots/typing-test.webp)

An automated candidate screening platform that lets HR teams conduct structured interviews via shareable links — no scheduling required. Candidates fill in a prescreening form, answer interview questions, and complete a typing test. GPT-4o mini scores each candidate automatically across five dimensions.

## Features

- **Role-based access** — Admin and HR user roles, each with their own dashboard
- **Interview templates** — Create templates with custom questions, duration, and typing text
- **Shareable links** — Generate unique interview links to send to candidates
- **Prescreening form** — Collects resume (PDF), personal details, education, work history, and salary expectations
- **Live interview chat** — Timed, one-question-at-a-time format with a countdown timer
- **Typing test** — Measures WPM and accuracy as part of the assessment
- **AI scoring** — GPT-4o mini scores candidates on Experience, Skills, Stability, Communication, and Role Fit (out of 100)
- **Auto-score all** — Score all completed candidates in one click
- **Candidate ranking** — Ranked leaderboard with score breakdown per session
- **HR notes** — Add private notes to any candidate session
- **Dark / light theme** — Toggle between dark and light mode, preference saved across sessions
- **Email verification** — Account signup includes email verification via Resend

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js |
| Framework | Express.js |
| Templating | EJS |
| Database | PostgreSQL (Supabase) |
| Auth | bcrypt + express-session |
| AI Scoring | OpenAI GPT-4o mini |
| File uploads | Multer |
| Email | Resend |
| Deployment | Vercel / Docker |

## Getting Started

### Prerequisites

- Node.js 20+
- A [Supabase](https://supabase.com) project (PostgreSQL)
- An [OpenAI](https://platform.openai.com) API key
- A [Resend](https://resend.com) API key and verified domain

### Setup

1. **Clone and install**
   ```bash
   git clone https://github.com/celestinediask/hireflow.git
   cd hireflow
   npm install
   ```

2. **Configure environment**

   Create a `.env` file in the project root:
   ```env
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_SERVICE_KEY=your-service-role-key
   DATABASE_URL=postgresql://postgres.your-project:password@aws-0-region.pooler.supabase.com:6543/postgres
   OPENAI_API_KEY=sk-...
   RESEND_API_KEY=re_...
   FROM_EMAIL=no-reply@yourdomain.com
   SESSION_SECRET=some-long-random-string
   ```

3. **Start the server**
   ```bash
   ./start.sh
   ```

   The app will create all database tables on first run, then listen on [http://localhost:3000](http://localhost:3000).

4. **First login**

   Register an account at `/login`. The first registered user is automatically promoted to admin.

### Docker

```bash
docker compose up
```

### Vercel

The repo includes `vercel.json` for serverless deployment. Set all environment variables in your Vercel project settings, then deploy:

```bash
vercel deploy
```

## Project Structure

```
src/
├── app.js              # Express app entry point
├── db.js               # PostgreSQL pool, schema init, all queries
├── email.js            # Resend email helper
├── supabase.js         # Supabase client (file uploads)
├── middleware/
│   └── auth.js         # Session auth guards
├── routes/
│   ├── auth.js         # Login, signup, email verification
│   ├── admin.js        # Admin dashboard, HR user management
│   ├── hr.js           # Templates, sessions, scoring
│   └── interview.js    # Candidate-facing interview flow
├── utils/
│   └── scorer.js       # OpenAI GPT-4o mini scoring logic
└── views/              # EJS templates
    ├── admin/
    ├── hr/
    └── interview/
```

## User Roles

| Role | Access |
|---|---|
| **Admin** | Manages HR users, views all templates and sessions |
| **HR** | Creates interview templates, generates links, scores candidates |
| **Candidate** | Accesses interview via unique link (no account needed) |

## AI Scoring

Each completed interview is scored by GPT-4o mini on five factors (20 points each):

| Factor | What it measures |
|---|---|
| **Experience** | Years of relevant experience, career progression |
| **Skills** | Technical/domain skills for the specific role |
| **Stability** | Job tenure consistency, low job-hopping |
| **Communication** | Clarity and depth of interview responses |
| **Role Fit** | Overall alignment with the role |

Scores can be applied individually or in bulk with **Auto-Score All**.
