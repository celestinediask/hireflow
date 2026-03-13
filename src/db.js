const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id              SERIAL PRIMARY KEY,
      username        TEXT NOT NULL,
      email           TEXT NOT NULL UNIQUE,
      password_hash   TEXT NOT NULL,
      plain_password  TEXT,
      is_verified     INTEGER NOT NULL DEFAULT 0,
      verify_token    TEXT,
      role            TEXT NOT NULL DEFAULT 'user',
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS interview_templates (
      id               SERIAL PRIMARY KEY,
      title            TEXT NOT NULL,
      created_by       INTEGER NOT NULL REFERENCES users(id),
      duration_minutes INTEGER NOT NULL DEFAULT 30,
      typing_text      TEXT,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS template_questions (
      id            SERIAL PRIMARY KEY,
      template_id   INTEGER NOT NULL REFERENCES interview_templates(id) ON DELETE CASCADE,
      sort_order    INTEGER NOT NULL,
      question_text TEXT NOT NULL
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS interview_sessions (
      id                      SERIAL PRIMARY KEY,
      template_id             INTEGER NOT NULL REFERENCES interview_templates(id),
      token                   TEXT NOT NULL UNIQUE,
      candidate_name          TEXT,
      candidate_email         TEXT,
      current_question_index  INTEGER NOT NULL DEFAULT 0,
      status                  TEXT NOT NULL DEFAULT 'pending',
      started_at              TIMESTAMPTZ,
      completed_at            TIMESTAMPTZ,
      expires_at              TIMESTAMPTZ,
      wpm                     REAL,
      accuracy                REAL,
      created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`ALTER TABLE interview_sessions ADD COLUMN IF NOT EXISTS hr_notes TEXT`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS interview_responses (
      id            SERIAL PRIMARY KEY,
      session_id    INTEGER NOT NULL REFERENCES interview_sessions(id),
      question_id   INTEGER NOT NULL REFERENCES template_questions(id),
      response_text TEXT NOT NULL,
      responded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS candidate_prescreening (
      id                SERIAL PRIMARY KEY,
      session_id        INTEGER NOT NULL UNIQUE REFERENCES interview_sessions(id),
      resume_path       TEXT,
      full_name         TEXT,
      dob               TEXT,
      phone             TEXT,
      email             TEXT,
      location          TEXT,
      qualification     TEXT,
      institution       TEXT,
      graduation_year   TEXT,
      work_experience   TEXT,
      last_ctc          TEXT,
      inhand_salary     TEXT,
      expected_salary   TEXT,
      notice_period     TEXT,
      reason_leaving    TEXT,
      job_switches      TEXT,
      career_changes    TEXT,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS candidate_scores (
      id             SERIAL PRIMARY KEY,
      session_id     INTEGER NOT NULL UNIQUE REFERENCES interview_sessions(id),
      experience     INTEGER NOT NULL DEFAULT 0,
      skills         INTEGER NOT NULL DEFAULT 0,
      stability      INTEGER NOT NULL DEFAULT 0,
      communication  INTEGER NOT NULL DEFAULT 0,
      role_fit       INTEGER NOT NULL DEFAULT 0,
      override_total INTEGER,
      notes          TEXT,
      shortlisted    INTEGER NOT NULL DEFAULT 0,
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Auto-promote first user to admin if no admin exists
  const adminCheck = await pool.query("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
  if (adminCheck.rows.length === 0) {
    const firstUser = await pool.query('SELECT id FROM users ORDER BY id LIMIT 1');
    if (firstUser.rows.length > 0) {
      await pool.query('UPDATE users SET role = $1 WHERE id = $2', ['admin', firstUser.rows[0].id]);
    }
  }
}

const DEFAULT_TYPING_TEXT = 'The quick brown fox jumps over the lazy dog. Practice makes perfect, and every great journey begins with a single step.';

const queries = {
  // Users
  createUser: (username, email, passwordHash, verifyToken) =>
    pool.query(
      'INSERT INTO users (username, email, password_hash, verify_token) VALUES ($1, $2, $3, $4)',
      [username, email, passwordHash, verifyToken]
    ),

  findByEmail: async (email) => {
    const r = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    return r.rows[0] || null;
  },

  findByToken: async (token) => {
    const r = await pool.query('SELECT * FROM users WHERE verify_token = $1', [token]);
    return r.rows[0] || null;
  },

  verifyUser: (id) =>
    pool.query('UPDATE users SET is_verified = 1, verify_token = NULL WHERE id = $1', [id]),

  findById: async (id) => {
    const r = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    return r.rows[0] || null;
  },

  // HR user management
  getAllHRUsers: async () => {
    const r = await pool.query("SELECT * FROM users WHERE role = 'hr' ORDER BY created_at DESC");
    return r.rows;
  },

  createHRUser: (username, email, passwordHash, plainPassword) =>
    pool.query(
      "INSERT INTO users (username, email, password_hash, plain_password, is_verified, role) VALUES ($1, $2, $3, $4, 1, 'hr')",
      [username, email, passwordHash, plainPassword]
    ),

  updateHRUser: (username, email, passwordHash, plainPassword, id, role) =>
    pool.query(
      'UPDATE users SET username = $1, email = $2, password_hash = $3, plain_password = $4 WHERE id = $5 AND role = $6',
      [username, email, passwordHash, plainPassword, id, role]
    ),

  updateHRUserNoPassword: (username, email, id, role) =>
    pool.query(
      'UPDATE users SET username = $1, email = $2 WHERE id = $3 AND role = $4',
      [username, email, id, role]
    ),

  deleteResponsesBySession: (sessionId) =>
    pool.query('DELETE FROM interview_responses WHERE session_id = $1', [sessionId]),

  deleteSessionsByTemplate: (templateId) =>
    pool.query('DELETE FROM interview_sessions WHERE template_id = $1', [templateId]),

  deleteTemplatesByUser: (userId) =>
    pool.query('DELETE FROM interview_templates WHERE created_by = $1', [userId]),

  deleteHRUser: (id) =>
    pool.query("DELETE FROM users WHERE id = $1 AND role = 'hr'", [id]),

  findAdmin: async () => {
    const r = await pool.query("SELECT * FROM users WHERE role = 'admin' LIMIT 1");
    return r.rows[0] || null;
  },

  updateAdminUser: (username, email, passwordHash, plainPassword, id, role) =>
    pool.query(
      'UPDATE users SET username = $1, email = $2, password_hash = $3, plain_password = $4 WHERE id = $5 AND role = $6',
      [username, email, passwordHash, plainPassword, id, role]
    ),

  updateAdminUserNoPassword: (username, email, id, role) =>
    pool.query(
      'UPDATE users SET username = $1, email = $2 WHERE id = $3 AND role = $4',
      [username, email, id, role]
    ),

  storePlainPassword: (plainPassword, id) =>
    pool.query('UPDATE users SET plain_password = $1 WHERE id = $2', [plainPassword, id]),

  // Templates
  createTemplate: async (title, createdBy, durationMinutes, typingText) => {
    const r = await pool.query(
      'INSERT INTO interview_templates (title, created_by, duration_minutes, typing_text) VALUES ($1, $2, $3, $4) RETURNING id',
      [title, createdBy, durationMinutes, typingText]
    );
    return { lastInsertRowid: r.rows[0].id };
  },

  getTemplatesByUser: async (userId) => {
    const r = await pool.query(
      'SELECT * FROM interview_templates WHERE created_by = $1 ORDER BY created_at DESC',
      [userId]
    );
    return r.rows;
  },

  getAllTemplates: async () => {
    const r = await pool.query('SELECT * FROM interview_templates ORDER BY created_at DESC');
    return r.rows;
  },

  getTemplateById: async (id) => {
    const r = await pool.query('SELECT * FROM interview_templates WHERE id = $1', [id]);
    return r.rows[0] || null;
  },

  deleteTemplate: (id) =>
    pool.query('DELETE FROM interview_templates WHERE id = $1', [id]),

  // Questions
  createQuestion: (templateId, sortOrder, questionText) =>
    pool.query(
      'INSERT INTO template_questions (template_id, sort_order, question_text) VALUES ($1, $2, $3)',
      [templateId, sortOrder, questionText]
    ),

  getQuestionsByTemplate: async (templateId) => {
    const r = await pool.query(
      'SELECT * FROM template_questions WHERE template_id = $1 ORDER BY sort_order',
      [templateId]
    );
    return r.rows;
  },

  getQuestionById: async (id) => {
    const r = await pool.query('SELECT * FROM template_questions WHERE id = $1', [id]);
    return r.rows[0] || null;
  },

  // Sessions
  createSession: async (templateId, token) => {
    const r = await pool.query(
      "INSERT INTO interview_sessions (template_id, token, expires_at) VALUES ($1, $2, NOW() + INTERVAL '24 hours') RETURNING id",
      [templateId, token]
    );
    return { lastInsertRowid: r.rows[0].id };
  },

  getSessionByToken: async (token) => {
    const r = await pool.query('SELECT * FROM interview_sessions WHERE token = $1', [token]);
    return r.rows[0] || null;
  },

  getSessionById: async (id) => {
    const r = await pool.query('SELECT * FROM interview_sessions WHERE id = $1', [id]);
    return r.rows[0] || null;
  },

  getSessionsByTemplate: async (templateId) => {
    const r = await pool.query(
      'SELECT * FROM interview_sessions WHERE template_id = $1 ORDER BY created_at DESC',
      [templateId]
    );
    return r.rows;
  },

  savePrescreeningToSession: (fullName, email, sessionId) =>
    pool.query(
      "UPDATE interview_sessions SET candidate_name = $1, candidate_email = $2, status = 'prescreening_done' WHERE id = $3",
      [fullName, email, sessionId]
    ),

  beginInterview: (sessionId) =>
    pool.query(
      "UPDATE interview_sessions SET status = 'in_progress', started_at = NOW() WHERE id = $1",
      [sessionId]
    ),

  setTypingTest: (sessionId) =>
    pool.query("UPDATE interview_sessions SET status = 'typing_test' WHERE id = $1", [sessionId]),

  completeSession: (wpm, accuracy, sessionId) =>
    pool.query(
      "UPDATE interview_sessions SET status = 'completed', wpm = $1, accuracy = $2, completed_at = NOW() WHERE id = $3",
      [wpm, accuracy, sessionId]
    ),

  expireSession: (sessionId) =>
    pool.query(
      "UPDATE interview_sessions SET status = 'completed', completed_at = NOW() WHERE id = $1 AND status != 'completed'",
      [sessionId]
    ),

  advanceSession: (index, sessionId) =>
    pool.query(
      'UPDATE interview_sessions SET current_question_index = $1 WHERE id = $2',
      [index, sessionId]
    ),

  updateHrNotes: (sessionId, hrNotes) =>
    pool.query(
      'UPDATE interview_sessions SET hr_notes = $1 WHERE id = $2',
      [hrNotes, sessionId]
    ),

  // Prescreening
  createPrescreening: (
    sessionId, resumePath, fullName, dob, phone, email, location,
    qualification, institution, graduationYear, workExperience,
    lastCtc, inhandSalary, expectedSalary, noticePeriod,
    reasonLeaving, jobSwitches, careerChanges
  ) =>
    pool.query(
      `INSERT INTO candidate_prescreening
        (session_id, resume_path, full_name, dob, phone, email, location,
         qualification, institution, graduation_year, work_experience,
         last_ctc, inhand_salary, expected_salary, notice_period,
         reason_leaving, job_switches, career_changes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
      [sessionId, resumePath, fullName, dob, phone, email, location,
       qualification, institution, graduationYear, workExperience,
       lastCtc, inhandSalary, expectedSalary, noticePeriod,
       reasonLeaving, jobSwitches, careerChanges]
    ),

  getPrescreeningBySession: async (sessionId) => {
    const r = await pool.query(
      'SELECT * FROM candidate_prescreening WHERE session_id = $1',
      [sessionId]
    );
    return r.rows[0] || null;
  },

  // Scores
  upsertScore: (sessionId, experience, skills, stability, communication, roleFit, overrideTotal, notes, shortlisted) =>
    pool.query(
      `INSERT INTO candidate_scores
        (session_id, experience, skills, stability, communication, role_fit, override_total, notes, shortlisted, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
       ON CONFLICT(session_id) DO UPDATE SET
         experience = EXCLUDED.experience,
         skills = EXCLUDED.skills,
         stability = EXCLUDED.stability,
         communication = EXCLUDED.communication,
         role_fit = EXCLUDED.role_fit,
         override_total = EXCLUDED.override_total,
         notes = EXCLUDED.notes,
         shortlisted = EXCLUDED.shortlisted,
         updated_at = NOW()`,
      [sessionId, experience, skills, stability, communication, roleFit, overrideTotal, notes, shortlisted]
    ),

  getScoreBySession: async (sessionId) => {
    const r = await pool.query(
      'SELECT * FROM candidate_scores WHERE session_id = $1',
      [sessionId]
    );
    return r.rows[0] || null;
  },

  getScoredSessionsByTemplate: async (templateId) => {
    const r = await pool.query(
      `SELECT s.id as session_id, s.candidate_name, s.candidate_email, s.wpm, s.accuracy, s.completed_at,
              sc.experience, sc.skills, sc.stability, sc.communication, sc.role_fit,
              sc.override_total, sc.notes, sc.shortlisted
       FROM interview_sessions s
       LEFT JOIN candidate_scores sc ON sc.session_id = s.id
       WHERE s.template_id = $1 AND s.status = 'completed'
       ORDER BY s.completed_at DESC`,
      [templateId]
    );
    return r.rows;
  },

  // Responses
  createResponse: (sessionId, questionId, responseText) =>
    pool.query(
      'INSERT INTO interview_responses (session_id, question_id, response_text) VALUES ($1, $2, $3)',
      [sessionId, questionId, responseText]
    ),

  getResponsesBySession: async (sessionId) => {
    const r = await pool.query(
      `SELECT ir.*, tq.question_text, tq.sort_order
       FROM interview_responses ir
       JOIN template_questions tq ON ir.question_id = tq.id
       WHERE ir.session_id = $1
       ORDER BY tq.sort_order`,
      [sessionId]
    );
    return r.rows;
  },
};

module.exports = { pool, queries, DEFAULT_TYPING_TEXT, initDB };
